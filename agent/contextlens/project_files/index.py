"""Incrementally index selected folders and retrieve attributable passages for a project turn."""
import hashlib
import os
import re
from pathlib import Path
from threading import Lock

from contextlens.memory.search import tokens
from contextlens.memory.store import session

from .documents import IMAGE_SUFFIXES, extract, files
from .folders import file_stamp, open_root

_SYNC = Lock()
_CHUNK = 1600


def _terms(text: str) -> str:
    # FTS handles Latin word boundaries. Segment Chinese runs for matching inside sentences.
    return re.sub(r"[\u3400-\u9fff]+", lambda m: " " + " ".join(tokens(m[0])) + " ", text.replace("_", " "))


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
        chunks = [text[i:i + _CHUNK] for i in range(0, len(text), _CHUNK - 160)]
        batch.append((path, stamp, image_indexed, _terms(path), [(_terms(chunk), chunk) for chunk in chunks]))
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
            conn.execute("DELETE FROM project_passages WHERE document_id = ?", (doc,))
            conn.executemany("INSERT INTO project_passages(document_id, name, terms, excerpt) VALUES (?, ?, ?, ?)",
                             ((doc, name, terms, excerpt) for terms, excerpt in chunks))
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
    return active


def search(scope: str, question: str, *, inventory: bool = False, selected=()) -> list[dict]:
    """In field mode include all readable files. Ranking and passages come from the same FTS query."""
    active = _active_folders(scope) if question.strip() or inventory else []
    if not active:
        return []
    marks = ",".join("?" for _ in active)
    source = "FROM project_documents d JOIN project_folders f ON d.folder_id = f.id"
    scope_filter = f"f.project_id = ? AND f.id IN ({marks})"
    params = (scope, *active)
    words = list(dict.fromkeys(re.findall(r"\w+", _terms(question).lower())))[:48]
    with session() as conn:
        # A nested folder may also be linked on its own. Keep the same source id when a query
        # matches the two bindings differently, so a chosen file keeps its place in the input.
        catalog = {}
        if inventory:
            rows = conn.execute(f"""SELECT f.id AS folder, f.path AS root, d.path, d.stamp, p.excerpt,
                MIN(p.rowid) AS first_page {source}
                JOIN project_passages p ON p.document_id = d.id
                WHERE {scope_filter} GROUP BY d.id ORDER BY f.path, d.path""", params)
            for row in rows:
                if row["excerpt"]:
                    catalog.setdefault(os.path.join(row["root"], row["path"]), row)
        limit = "" if inventory else "LIMIT 24"
        matches = conn.execute(f"""
            SELECT f.id AS folder, f.path AS root, d.path, d.stamp, p.excerpt {source}
            JOIN project_passages p ON p.document_id = d.id
            WHERE {scope_filter} AND project_passages MATCH ?
            ORDER BY bm25(project_passages, 0, 6, 1, 0), d.path, p.rowid {limit}
        """, (*params, " OR ".join(f'"{word}"' for word in words))) if words else []
        hits = []
        seen = set()

        def card(row, excerpt, rank=None):
            label = f'{Path(row["root"]).name}/{row["path"]}'
            source_id = _id(scope, row["root"], row["path"])
            return {"id": source_id, "title": label, "source_label": label, "rank": rank,
                    "content": excerpt if not inventory or source_id in (selected or ()) or (selected is None and rank is not None and rank <= 4) else excerpt[:200],
                    "files": [_dependency(row)]}

        for row in matches:
            absolute = os.path.join(row["root"], row["path"])
            if absolute in seen:
                continue
            seen.add(absolute)
            hits.append(card(catalog.get(absolute, row), row["excerpt"], len(hits) + 1))
            if not inventory and len(hits) == 4:
                break
        hits.extend(card(row, row["excerpt"]) for path, row in catalog.items() if path not in seen)
        return hits


def browse(scope: str, name: str, file_id: str, offset: int, excluded: set[str],
           allowed: set[str] | None = None) -> tuple[str, dict]:
    """Search file names or read a page from one file. Resolve ids only inside active bindings."""
    if allowed is not None and (not allowed or (file_id and file_id not in allowed)):
        return "No matching files.", {}
    active = _active_folders(scope)
    if not active:
        return "No accessible project folders.", {}
    marks = ",".join("?" for _ in active)
    offset = max(0, offset)
    with session() as conn:
        rows = conn.execute(f"""SELECT d.id, d.path, d.stamp, f.id AS folder, f.path AS root FROM project_documents d
            JOIN project_folders f ON d.folder_id = f.id WHERE f.project_id = ? AND f.id IN ({marks})
            ORDER BY f.path, d.path""", (scope, *active))
        inventory_id = _id(scope, "inventory", "")
        if not file_id and inventory_id in excluded:
            return "The file listing has been excluded from this turn.", {}
        matches = []
        dependencies = []
        matched = 0
        for row in rows:
            source_id = _id(scope, row["root"], row["path"])
            if source_id in excluded or (allowed is not None and source_id not in allowed):
                continue
            label = f'{Path(row["root"]).name}/{row["path"]}'
            if file_id:
                if file_id != source_id:
                    continue
                pages = conn.execute("SELECT excerpt FROM project_passages WHERE document_id = ? "
                                     "ORDER BY rowid LIMIT 2 OFFSET ?", (row["id"], offset)).fetchall()
                if not pages:
                    return "No readable text at this page.", {}
                doc = {"id": source_id, "title": label, "source_label": label, "content": pages[0]["excerpt"], "files": [_dependency(row)]}
                more = f" Next page: {offset + 1}." if len(pages) > 1 else ""
                return f"[{source_id}] {label} (page {offset}).{more}\n{doc['content']}", {"document": doc}
            if name.casefold() in label.casefold():
                matched += 1
                if matched <= offset:
                    continue
                if len(matches) == 40:
                    matches.append(f"Next offset: {offset + 40}.")
                    break
                matches.append(f"[{source_id}] {label}")
                dependencies.append(_dependency(row))
        if file_id:
            return "This file is unavailable in this context.", {}
        if not matches:
            return "No matching files.", {}
        listing = "\n".join(matches)
        doc = {"id": inventory_id, "title": "Project files", "source_label": "Project files",
               "content": listing, "files": dependencies}
        return f"[{inventory_id}] Project files:\n{listing}", {"document": doc}
