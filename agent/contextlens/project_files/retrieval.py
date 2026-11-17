"""Find a project's passages by words and by meaning (hybrid.py), then let the reranker judge them.

Only PDF and Word files have passages searched by content (index.py); any other file has one empty
passage, found by its name. Vectors are made in the background after a file is split; until a passage
has one, words alone find it.

Each route keeps at most PER_FILE passages of a file before it keeps its best LIMIT, so one long file
cannot take every place. A file's name counts for little next to its text: every passage of the file
carries the name, and a short field scores high in BM25.
"""
from __future__ import annotations

import logging
from typing import NamedTuple

from llama_index.core.postprocessor.types import BaseNodePostprocessor
from llama_index.core.schema import NodeWithScore, QueryBundle

from contextlens import hybrid
from contextlens.memory.store import session
from contextlens.models import local_reranker

from .documents import DOCUMENT_SUFFIXES

log = logging.getLogger(__name__)
_COLUMNS = "p.rowid AS passage, d.id AS document, f.id AS folder, f.path AS root, d.path, d.stamp, p.page, p.excerpt"
_METADATA = ("passage", "folder", "root", "path", "stamp", "page")
PER_FILE = 2  # passages of one file a route may keep
NAME_WEIGHT = 2  # BM25 weight of the file's name; its text weighs 1
# The reranker reads the best passages of the files that came first, at most JUDGED of them; a file whose
# best one it scores below RELEVANT is listed but not sent. On the user's files (docs/adr/0004) unrelated
# questions scored at most 0.002 and the passage that answered 0.5 or more.
JUDGED = 12
JUDGED_CHARS = 800  # of each passage; the top scores held while the time halved
RELEVANT = 0.3


def _best_per_file(inner: str, order: str) -> str:
    """Rows of `inner`, at most PER_FILE per document, best first by `order`."""
    return f"""SELECT * FROM (SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.document ORDER BY {order}, x.passage)
        AS nth FROM ({inner}) x) WHERE nth <= {PER_FILE} ORDER BY {order}, path, passage"""


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
        inner = f"""SELECT {_COLUMNS}, bm25(project_passages, 0, 0, {NAME_WEIGHT}, 1, 0) AS rank {within.source}
                WHERE {within.where} AND project_passages MATCH ?"""
        with session() as conn:
            rows = conn.execute(_best_per_file(inner, "rank") + ("" if limit is None else f" LIMIT {int(limit)}"),
                                (*within.params, query)).fetchall()
        return [_node(r, -r["rank"]) for r in rows]

    def meaning(q: str, found):
        inner = f"""SELECT {_COLUMNS}, vec_distance_cosine(v.vector, ?) AS distance {within.source}
                JOIN project_passage_vectors v ON v.passage_id = p.rowid WHERE {within.where} AND v.model = ?"""
        with session() as conn:
            rows = conn.execute(_best_per_file(inner, "distance") + " LIMIT ?",
                                (hybrid.query_vector(q, found), *within.params, found.model,
                                 hybrid.MEANING_LIMIT)).fetchall()
        return [_node(r, 1 - r["distance"]) for r in rows if hybrid.close(r["distance"])]

    with session() as conn:
        has_vectors = conn.execute("SELECT 1 FROM project_passage_vectors LIMIT 1").fetchone() is not None
    nodes = hybrid.fuse(question, words, meaning, has_vectors, top=10_000)
    return [{**n.node.metadata, "excerpt": n.node.get_content()} for n in nodes]


class _Rerank(BaseNodePostprocessor):
    """LlamaIndex's step after retrieval: each passage scored by the local reranker, best first."""
    scores: list[float] | None = None

    def _postprocess_nodes(self, nodes: list[NodeWithScore], query_bundle: QueryBundle | None = None):
        texts = [f'{n.node.metadata["path"]}\n{n.node.get_content()[:JUDGED_CHARS]}' for n in nodes]
        self.scores = local_reranker.scores(query_bundle.query_str, texts) if query_bundle else None
        if self.scores is None:
            return nodes
        judged = [NodeWithScore(node=n.node, score=s) for n, s in zip(nodes, self.scores)]
        return sorted(judged, key=lambda n: -n.score)


def judge(question: str, passages: list[dict]) -> dict[int, float] | None:
    """How likely each passage answers the question, by passage; None without a reranker."""
    if not passages:
        return {}
    nodes = [_node(p, 0.0) for p in passages]
    rerank = _Rerank()
    try:
        judged = rerank.postprocess_nodes(nodes, query_str=question)
    except Exception as e:  # a failing model must not take the turn down; the fused order still stands
        log.warning("reranking skipped: %s: %s", type(e).__name__, str(e)[:200])
        return None
    if rerank.scores is None:
        return None
    return {n.node.metadata["passage"]: n.score for n in judged}
