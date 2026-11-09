"""Find a project's passages by words and by meaning (hybrid.py).

Only PDF and Word files have passages searched by content (index.py); any other file has one empty
passage, found by its name. Vectors are made in the background after a file is split; until a passage
has one, words alone find it.
"""
from __future__ import annotations

from typing import NamedTuple

from contextlens import hybrid
from contextlens.memory.store import session

from .documents import DOCUMENT_SUFFIXES

_COLUMNS = "p.rowid AS passage, f.id AS folder, f.path AS root, d.path, d.stamp, p.page, p.excerpt"
_METADATA = ("passage", "folder", "root", "path", "stamp", "page")

vectors = hybrid.Vectors("passages", session, "project_passages", "project_passage_vectors", f"""
    SELECT p.rowid, p.excerpt FROM project_passages p JOIN project_documents d ON d.id = p.document_id
    WHERE p.excerpt != '' AND ({" OR ".join(f"lower(d.path) LIKE '%{s}'" for s in sorted(DOCUMENT_SUFFIXES))})
    AND NOT EXISTS (SELECT 1 FROM project_passage_vectors v WHERE v.passage_id = p.rowid AND v.model = ?)
    ORDER BY p.rowid LIMIT ?""", background=True)


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


def _node(row, score: float):
    return hybrid.node("passage", row, score, {k: row[k] for k in _METADATA})


def find(within: Within, question: str, *, limit: int | None) -> list[dict]:
    """Passages for the question, best first: up to `limit` by words, plus the closest by meaning."""
    if not question.strip():
        return []

    def words(q: str):
        query = hybrid.match(q)
        if query is None:
            return []
        with session() as conn:
            rows = conn.execute(f"""SELECT {_COLUMNS}, bm25(project_passages, 0, 0, 6, 1, 0) AS rank {within.source}
                WHERE {within.where} AND project_passages MATCH ?
                ORDER BY rank, d.path, p.rowid {"" if limit is None else f"LIMIT {int(limit)}"}""",
                                (*within.params, query)).fetchall()
        return [_node(r, -r["rank"]) for r in rows]

    def meaning(q: str, found):
        with session() as conn:
            rows = conn.execute(f"""SELECT {_COLUMNS}, vec_distance_cosine(v.vector, ?) AS distance {within.source}
                JOIN project_passage_vectors v ON v.passage_id = p.rowid
                WHERE {within.where} AND v.model = ? ORDER BY distance LIMIT ?""",
                                (hybrid.query_vector(q, found), *within.params, found.model,
                                 hybrid.MEANING_LIMIT)).fetchall()
        return [_node(r, 1 - r["distance"]) for r in rows if hybrid.close(r["distance"])]

    with session() as conn:
        has_vectors = conn.execute("SELECT 1 FROM project_passage_vectors LIMIT 1").fetchone() is not None
    nodes = hybrid.fuse(question, words, meaning, has_vectors, top=10_000)
    return [{**n.node.metadata, "excerpt": n.node.get_content()} for n in nodes]
