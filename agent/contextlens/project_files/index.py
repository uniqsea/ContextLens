"""Incrementally index selected folders and retrieve attributable passages for a project turn.

Only PDF and Word files are split into passages, by LlamaIndex's sentence splitter (Chinese and English
sentence ends both count), page by page for a PDF so each passage knows its page. Their passages are
found by words (SQLite FTS5 over jieba segments) and by meaning (vectors from the local embedding
model), fused by rank (retrieval.py). Any other file is found by its name and keeps only its beginning
to show; the agent reads the rest with its file tools. An image keeps its one-line description.
"""
import hashlib
import os
from pathlib import Path
from threading import Lock

from contextlens.passages import split, terms
from contextlens.memory.store import session

from . import retrieval
from .documents import IMAGE_SUFFIXES, extract, files
from .folders import file_stamp, open_root

_SYNC = Lock()
HEAD_CHARS = 1600





def passages(name: str, text: str) -> list[tuple[int | None, str]]:
    """(page, passage) in reading order; pages count from 1 and only a PDF has them (pdftotext ends
    each page with a form feed)."""
    paged = name.lower().endswith(".pdf")
    out = []
    for number, page in enumerate(text.split("\f") if paged else [text], 1):
        if page.strip():
            out.extend((number if paged else None, piece) for piece in split(page))
    return out


def _contents(path: str, text: str, image: bool) -> list[tuple[int | None, str, str]]:
    """(page, searchable words, text) for each passage a file is kept as."""
    if Path(path).suffix.lower() in retrieval.SPLIT_SUFFIXES or image:
        return [(page, terms(piece), piece) for page, piece in passages(path, text)]
    head = text[:HEAD_CHARS].strip()
    return [(None, "", head)] if head else []


def _refresh(folder, root_fd):
    with session() as conn:
        known = {r["path"]: (r["stamp"], r["image_indexed"]) for r in conn.execute(
            "SELECT path, stamp, image_indexed FROM project_documents WHERE folder_id = ?", (folder["id"],))}
    batch = []
    batch_size = 0
    for path, parent_fd, st in files(root_fd):
        stamp = file_stamp(st)
        image_indexed = Path(path).suffix.lower() in IMAGE_SUFFIXES
        if known.pop(path, None) == (stamp, image_indexed):
            continue
        text = extract(os.path.basename(path), parent_fd, st.st_size)
        batch.append((path, stamp, image_indexed, terms(path), _contents(path, text, image_indexed)))
        batch_size += len(text)
        if len(batch) >= 64 or batch_size >= 512_000:
            if not _write_batch(folder, batch):
                return
            batch.clear()
            batch_size = 0
    if batch:
        _write_batch(folder, batch)
    if known:
        with session() as conn:
            conn.executemany("DELETE FROM project_documents WHERE folder_id = ? AND path = ?",
                             ((folder["id"], path) for path in known))


def _write_batch(folder, batch):
    folder_id = folder["id"]
    # Extraction happens before this short write transaction, so other chats can use the store.
    with session() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if not conn.execute("SELECT 1 FROM project_folders WHERE id = ?", (folder_id,)).fetchone():
            return False
        for path, stamp, image_indexed, name, chunks in batch:
            source_id = _id(folder["project_id"], folder["path"], path)
            doc = conn.execute("""INSERT INTO project_documents(folder_id, path, stamp, image_indexed, source_id)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(folder_id, path) DO UPDATE SET
                stamp = excluded.stamp, image_indexed = excluded.image_indexed RETURNING id""",
                (folder_id, path, stamp, image_indexed, source_id)).fetchone()[0]
            conn.execute("DELETE FROM project_passage_vectors WHERE passage_id IN "
                         "(SELECT rowid FROM project_passages WHERE document_id = ?)", (doc,))
            conn.execute("DELETE FROM project_passages WHERE document_id = ?", (doc,))
            conn.executemany("INSERT INTO project_passages(document_id, page, name, terms, excerpt) VALUES (?, ?, ?, ?, ?)",
                             ((doc, page, name, terms, excerpt) for page, terms, excerpt in chunks))
    return True


def _dependency(row):
    return {key: row[key] for key in ("folder", "path", "stamp")}


def _id(scope, root_id, path):
    return "doc-" + hashlib.sha256(f"{scope}/{root_id}/{path}".encode()).hexdigest()[:20]


def _active_folders(scope: str) -> list[str]:
    with session() as conn:
        roots = list(conn.execute("SELECT * FROM project_folders WHERE project_id = ? ORDER BY path", (scope,)))
    if not roots:
        return []
    active = []
    with _SYNC:
        for root in roots:
            try:
                with open_root(root) as fd:
                    _refresh(root, fd)
                active.append(root["id"])
            except OSError:
                continue
    retrieval.embed_soon()
    return active


def search(scope: str, question: str, *, inventory: bool = False, selected=()) -> list[dict]:
    """The best passage of each file that matches the question, best file first; in field mode every
    readable file too, unranked ones after."""
    active = _active_folders(scope) if question.strip() or inventory else []
    if not active:
        return []
    within = retrieval.Within(scope, tuple(active))
    with session() as conn:
        # A nested folder may also be linked on its own. Keep the same source id when a query
        # matches the two bindings differently, so a chosen file keeps its place in the input.
        catalog = {}
        if inventory:
            rows = conn.execute(f"""SELECT f.id AS folder, f.path AS root, d.path, d.stamp, p.page, p.excerpt,
                MIN(p.rowid) AS first_page {within.source}
                WHERE {within.where} GROUP BY d.id ORDER BY f.path, d.path""", within.params)
            for row in rows:
                if row["excerpt"]:
                    catalog.setdefault(os.path.join(row["root"], row["path"]), dict(row))
    matches = retrieval.find(within, question, limit=None if inventory else 24)
    hits = []
    seen = set()

    def card(row, passage, rank=None):
        label = f'{Path(row["root"]).name}/{row["path"]}'
        source_id = _id(scope, row["root"], row["path"])
        page = passage.get("page")
        excerpt = passage["excerpt"]
        return {"id": source_id, "title": label, "source_label": f"{label} · p. {page}" if page else label,
                "rank": rank, "page": page,
                "content": excerpt if not inventory or source_id in (selected or ()) or (selected is None and rank is not None and rank <= 4) else excerpt[:200],
                "files": [_dependency(row)]}

    for passage in matches:
        absolute = os.path.join(passage["root"], passage["path"])
        if absolute in seen:
            continue
        seen.add(absolute)
        hits.append(card(catalog.get(absolute, passage), passage, len(hits) + 1))
        if not inventory and len(hits) == 4:
            break
    hits.extend(card(row, row) for path, row in catalog.items() if path not in seen)
    return hits
