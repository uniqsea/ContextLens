"""Splitting project files into passages and finding them by words and by meaning. All texts are invented."""
import sqlite3
from pathlib import Path
from unittest.mock import patch

from langchain_core.embeddings import Embeddings

from contextlens import config, memory, models, project_files
from contextlens.memory.store import session
from contextlens.project_files import retrieval
from contextlens.project_files.index import passages
from tests.support import StoreTestCase, USER, _no_model

# A toy meaning space: words in either language that mean the same thing share a dimension.
_SENSES = [("ferry", "boat", "crossing", "渡轮", "船"), ("cost", "credits", "price", "票", "钱"),
           ("greenhouse", "温室", "棚"), ("water", "浇水", "滴灌")]


class Senses(Embeddings):
    def __init__(self):
        self.documents = 0

    def _vector(self, text):
        text = text.lower()
        return [float(any(w in text for w in sense)) for sense in _SENSES] + [0.01]

    def embed_documents(self, texts):
        self.documents += len(texts)
        return [self._vector(t) for t in texts]

    def embed_query(self, text):
        return self._vector(text)


class PassageTests(StoreTestCase):
    def setUp(self):
        super().setUp()
        self.senses = Senses()
        models.use(_no_model, embedding=("local/senses", self.senses))
        self.project = memory.operations.create_project("Fictional harbour", USER).id
        self.folder = Path(self._tmp.name) / "harbour"
        self.folder.mkdir()
        # Only PDF and Word files are split and searched by content; these PDFs "extract" to set texts.
        self.texts = {}
        self.pdf("ferry.pdf", "A single adult crossing on the north ferry costs 6 credits.\f")
        self.pdf("garden.pdf", "温室三号棚每天早上六点滴灌二十分钟。\f")
        read = project_files.index.extract
        extract = patch("contextlens.project_files.index.extract",
                        side_effect=lambda name, *a: self.texts[name] if name in self.texts else read(name, *a))
        extract.start()
        self.addCleanup(extract.stop)
        project_files.attach(self.project, [str(self.folder)])

    def pdf(self, name, text):
        self.texts[name] = text
        (self.folder / name).write_bytes(b"%PDF fictional " + str(len(self.texts) + len(text)).encode())

    def titles(self, question):
        return [d["title"] for d in project_files.search(self.project, question)]

    def counts(self):
        with session() as conn:
            return (conn.execute("SELECT count(*) FROM project_passage_vectors").fetchone()[0],
                    conn.execute("SELECT count(*) FROM project_passages WHERE excerpt != ''").fetchone()[0])

    def test_passages_end_at_sentences_and_a_pdf_keeps_its_pages(self):
        story = "青石镇的图书馆每周二闭馆，馆长决定把旧报纸搬到二楼。读者可以在线预约座位！借阅规则会改吗？" * 40
        pieces = passages("notes.md", story)
        self.assertGreater(len(pieces), 1)
        self.assertTrue(all(page is None for page, _ in pieces))
        self.assertTrue(all(text.endswith(("。", "！", "？")) for _, text in pieces[:-1]))
        self.assertEqual(passages("guide.pdf", "Lanterns on page one.\fThe switch is violet.\f\f"),
                         [(1, "Lanterns on page one."), (2, "The switch is violet.")])

    def test_a_question_in_other_words_or_another_language_finds_the_file_once_it_has_vectors(self):
        self.assertEqual(self.titles("船票多少钱"), [])  # no shared words
        self.assertEqual(self.titles("crossing"), ["harbour/ferry.pdf"])
        self.assertEqual(retrieval.embed_pending(), 2)
        self.assertEqual(self.titles("船票多少钱"), ["harbour/ferry.pdf"])
        self.assertEqual(self.titles("when is the greenhouse watered"), ["harbour/garden.pdf"])
        self.assertEqual(retrieval.embed_pending(), 0)  # nothing left to make

    def test_a_changed_file_loses_its_old_vectors_and_gets_new_ones(self):
        self.titles("ferry")  # files are indexed when first searched
        retrieval.embed_pending()
        self.assertEqual(self.counts(), (2, 2))
        self.pdf("ferry.pdf", "The ferry is suspended in storms. A crossing costs 7 credits.\f")
        self.titles("ferry")  # the index catches up with the folder
        self.assertEqual(self.counts(), (1, 2))
        retrieval.embed_pending()
        self.assertEqual(self.counts(), (2, 2))
        (self.folder / "ferry.pdf").unlink()
        self.titles("ferry")
        self.assertEqual(self.counts(), (1, 1))

    def test_the_model_is_not_loaded_while_no_passage_has_a_vector(self):
        with patch("contextlens.project_files.retrieval.embedder") as load:
            self.assertEqual(self.titles("crossing"), ["harbour/ferry.pdf"])
        load.assert_not_called()

    def test_without_a_local_model_words_still_work(self):
        models.use(_no_model)
        self.assertEqual(retrieval.embed_pending(), 0)
        self.assertEqual(self.titles("crossing"), ["harbour/ferry.pdf"])
        self.assertEqual(self.titles("船票多少钱"), [])

    def test_a_pdf_passage_says_its_page(self):
        self.pdf("guide.pdf", "Lanterns stand on the pier.\fThe lantern switch is violet.\f")
        [hit] = project_files.search(self.project, "switch")
        self.assertEqual((hit["title"], hit["page"], hit["source_label"]), ("harbour/guide.pdf", 2, "harbour/guide.pdf · p. 2"))

    def test_another_file_is_found_by_its_name_and_shows_its_beginning(self):
        (self.folder / "timetable.md").write_text("Sailings at noon. " + "Weather notes. " * 200 + "The pier lamp is violet.")
        self.assertEqual(self.titles("violet lamp"), [])  # its content is not searched
        retrieval.embed_pending()
        [hit] = project_files.search(self.project, "timetable")
        self.assertTrue(hit["content"].startswith("Sailings at noon."))
        self.assertNotIn("violet", hit["content"])
        self.assertEqual(self.counts(), (2, 3))  # its kept beginning gets no vector


class OldIndexTests(StoreTestCase):
    def test_an_index_from_before_pages_is_built_again(self):
        path = config.db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(path) as conn:
            conn.execute("CREATE VIRTUAL TABLE project_passages USING fts5(document_id UNINDEXED, name, terms, excerpt UNINDEXED)")
            conn.execute("CREATE TABLE project_documents (id INTEGER PRIMARY KEY, folder_id TEXT NOT NULL, path TEXT NOT NULL,"
                         " stamp TEXT NOT NULL, image_indexed INTEGER NOT NULL DEFAULT 0, UNIQUE(folder_id, path))")
            conn.execute("INSERT INTO project_documents (folder_id, path, stamp) VALUES ('f', 'a.md', 'old')")
            conn.execute("INSERT INTO project_passages (document_id, name, terms, excerpt) VALUES (1, 'a', 'a', 'old text')")
        with session() as conn:
            self.assertIn("page", {r["name"] for r in conn.execute("PRAGMA table_info(project_passages)")})
            self.assertEqual(conn.execute("SELECT count(*) FROM project_passages").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT stamp FROM project_documents").fetchone()[0], "")
