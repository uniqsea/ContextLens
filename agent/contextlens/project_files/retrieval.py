"""Find a project's passages by words and by meaning, fused by rank with LlamaIndex.

Two LlamaIndex retrievers over the same SQLite file: words through FTS5 (LlamaIndex's own BM25 splits no
Chinese, so the jieba segments indexed beside each passage are matched instead), and meaning through
sqlite-vec. `QueryFusionRetriever` merges them by reciprocal rank; it is given no model and asks none.

Vectors come only from the local embedding model, so file text never leaves the machine. Making them is
not switched on yet (`background`): on a laptop the model does about two passages a second, so a large
folder would take hours. Until a passage has a vector, words alone can find it, and while no passage
has one the model is not even loaded.
"""
from __future__ import annotations

import logging
import re
from threading import Lock, Thread
from typing import NamedTuple

import sqlite_vec
from llama_index.core.llms import MockLLM
from llama_index.core.retrievers import BaseRetriever, QueryFusionRetriever
from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode

from contextlens.memory.llm import embedder
from contextlens.memory.search import _COS_FLOOR, Embedder, _query_vector, tokens
from contextlens.memory.store import session

SPLIT_SUFFIXES = (".docx", ".pdf")  # the only files split into passages and searched by content

log = logging.getLogger(__name__)
_FIELDS = ("passage", "folder", "root", "path", "stamp", "page", "excerpt")
_MEANING_LIMIT = 24
EMBED_BATCH = 16
background = False  # not yet: which files to embed is undecided; tests embed when they choose


class Within(NamedTuple):
    """The passages of one project's readable folders, as SQL pieces."""
    scope: str
    folders: tuple[str, ...]

    @property
    def source(self) -> str:
        return ("FROM project_documents d JOIN project_folders f ON d.folder_id = f.id "
                "JOIN project_passages p ON p.document_id = d.id")

    @property
    def where(self) -> str:
        return f"f.project_id = ? AND f.id IN ({','.join('?' for _ in self.folders)})"

    @property
    def params(self) -> tuple:
        return (self.scope, *self.folders)


def _node(row, score: float) -> NodeWithScore:
    # Both routes build a passage's node the same way, so fusion counts it once.
    data = {k: row[k] for k in _FIELDS}
    return NodeWithScore(node=TextNode(id_=f"passage-{row['passage']}", text=row["excerpt"],
                                       metadata={k: v for k, v in data.items() if k != "excerpt"}), score=score)


class _Words(BaseRetriever):
    def __init__(self, within: Within, question: str, limit: int | None):
        super().__init__()
        self.within, self.limit = within, limit
        # jieba's words without stop words: "the" or "的" would match every file.
        self.words = list(dict.fromkeys(w for t in tokens(question) for w in re.findall(r"\w+", t)))[:48]

    def _retrieve(self, query: QueryBundle) -> list[NodeWithScore]:
        if not self.words:
            return []
        w = self.within
        with session() as conn:
            rows = conn.execute(f"""
                SELECT p.rowid AS passage, f.id AS folder, f.path AS root, d.path, d.stamp, p.page, p.excerpt,
                       bm25(project_passages, 0, 0, 6, 1, 0) AS rank {w.source}
                WHERE {w.where} AND project_passages MATCH ?
                ORDER BY rank, d.path, p.rowid {"" if self.limit is None else f"LIMIT {int(self.limit)}"}""",
                                (*w.params, " OR ".join(f'"{word}"' for word in self.words))).fetchall()
        return [_node(r, -r["rank"]) for r in rows]


class _Meaning(BaseRetriever):
    def __init__(self, within: Within, found: Embedder):
        super().__init__()
        self.within, self.found = within, found

    def _retrieve(self, query: QueryBundle) -> list[NodeWithScore]:
        w = self.within
        vector = sqlite_vec.serialize_float32(_query_vector(query.query_str.strip(), self.found))
        with session() as conn:
            rows = conn.execute(f"""
                SELECT p.rowid AS passage, f.id AS folder, f.path AS root, d.path, d.stamp, p.page, p.excerpt,
                       vec_distance_cosine(v.vector, ?) AS distance {w.source}
                JOIN project_passage_vectors v ON v.passage_id = p.rowid
                WHERE {w.where} AND v.model = ? ORDER BY distance LIMIT ?""",
                                (vector, *w.params, self.found.model, _MEANING_LIMIT)).fetchall()
        return [_node(r, 1 - r["distance"]) for r in rows if 1 - r["distance"] > _COS_FLOOR]


def find(within: Within, question: str, *, limit: int | None) -> list[dict]:
    """Passages for the question, best first: up to `limit` by words, plus the closest by meaning."""
    if not question.strip():
        return []
    retrievers: list[BaseRetriever] = [_Words(within, question, limit)]
    with session() as conn:
        any_vectors = conn.execute("SELECT 1 FROM project_passage_vectors LIMIT 1").fetchone() is not None
    found = embedder(local_only=True) if any_vectors else None
    if found is not None:
        retrievers.append(_Meaning(within, found))
    fused = QueryFusionRetriever(retrievers, llm=MockLLM(), mode="reciprocal_rerank", num_queries=1,
                                 use_async=False, similarity_top_k=10_000)
    try:
        nodes = fused.retrieve(question)
    except Exception as e:  # a failing model must not take the turn down; words still work
        log.warning("passage search by meaning skipped: %s: %s", type(e).__name__, str(e)[:200])
        nodes = retrievers[0].retrieve(question)
    return [{**n.node.metadata, "excerpt": n.node.get_content()} for n in nodes]


_embedding = Lock()


def embed_soon() -> None:
    """Make missing vectors in the background, unless that is already under way."""
    if background and not _embedding.locked():
        Thread(target=embed_pending, kwargs={"wait": False}, daemon=True, name="contextlens-embed-passages").start()


def embed_pending(*, wait: bool = True) -> int:
    """Give every passage a vector from the local model; returns how many were made."""
    if not _embedding.acquire(blocking=wait):
        return 0
    made = 0
    try:
        found = embedder(local_only=True)
        if found is None:
            return 0
        with session() as conn:
            conn.execute("DELETE FROM project_passage_vectors WHERE passage_id NOT IN (SELECT rowid FROM project_passages)")
        while True:
            with session() as conn:
                # Only split documents' passages; another file's kept beginning is not searched by content.
                rows = conn.execute(f"""SELECT p.rowid, p.excerpt FROM project_passages p
                    JOIN project_documents d ON d.id = p.document_id
                    WHERE p.excerpt != '' AND ({" OR ".join("lower(d.path) LIKE '%" + s + "'" for s in SPLIT_SUFFIXES)})
                    AND NOT EXISTS (SELECT 1 FROM project_passage_vectors v WHERE v.passage_id = p.rowid AND v.model = ?)
                    ORDER BY p.rowid LIMIT ?""", (found.model, EMBED_BATCH)).fetchall()
            if not rows:
                return made
            vectors = found.embeddings.embed_documents([r["excerpt"] for r in rows])
            with session() as conn:
                # A passage rewritten meanwhile has a new text, perhaps under the same rowid: skip it.
                conn.executemany("""INSERT OR REPLACE INTO project_passage_vectors (passage_id, model, vector)
                    SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM project_passages WHERE rowid = ? AND excerpt = ?)""",
                                 [(r["rowid"], found.model, sqlite_vec.serialize_float32(v), r["rowid"], r["excerpt"])
                                  for r, v in zip(rows, vectors)])
            made += len(rows)
    except Exception as e:
        log.warning("passage vectors not made: %s: %s", type(e).__name__, str(e)[:200])
        return made
    finally:
        _embedding.release()
