"""Passages found by words and by meaning in SQLite, fused by rank with LlamaIndex.

Shared by project files and conversation history; each says what its passages are with its own SQL.
Words go through FTS5: LlamaIndex's own BM25 splits no Chinese, so each passage is indexed beside its
jieba segments (passages.terms) and matched on those. Meaning goes through sqlite-vec, with vectors from
the local embedding model only, so nothing is sent out for it. `QueryFusionRetriever` merges the two
lists by reciprocal rank; it is given no model and asks none.

Vectors are made apart from searching (`Vectors`). Until a passage has one, words alone find it, and
while none has one the model is not even loaded.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Callable
from threading import Lock, Thread

import sqlite_vec
from llama_index.core.llms import MockLLM
from llama_index.core.retrievers import BaseRetriever, QueryFusionRetriever
from llama_index.core.schema import NodeWithScore, QueryBundle, TextNode

from contextlens.memory.llm import embedder
from contextlens.memory.search import _COS_FLOOR, Embedder, _query_vector, tokens

log = logging.getLogger(__name__)
MEANING_LIMIT = 24
EMBED_BATCH = 16

Fetch = Callable[[str], list[NodeWithScore]]


def match(question: str) -> str | None:
    """The FTS5 query for a question: its jieba words without stop words ("the" or "的" would match
    everything), any of them."""
    words = list(dict.fromkeys(w for t in tokens(question) for w in re.findall(r"\w+", t)))[:48]
    return " OR ".join(f'"{w}"' for w in words) or None


def node(kind: str, row, score: float, metadata: dict) -> NodeWithScore:
    """A passage as LlamaIndex sees it; both routes must build it the same way so fusion counts it once."""
    return NodeWithScore(node=TextNode(id_=f"{kind}-{row['passage']}", text=row["excerpt"], metadata=metadata),
                         score=score)


def query_vector(question: str, found: Embedder) -> bytes:
    return sqlite_vec.serialize_float32(_query_vector(question.strip(), found))


def close(distance: float) -> bool:
    """Near enough in meaning to count, by the same floor memories use."""
    return 1 - distance > _COS_FLOOR


class _Rows(BaseRetriever):
    def __init__(self, fetch: Fetch):
        super().__init__()
        self.fetch = fetch

    def _retrieve(self, query: QueryBundle) -> list[NodeWithScore]:
        return self.fetch(query.query_str)


def fuse(question: str, words: Fetch, meaning: Callable[[str, Embedder], list[NodeWithScore]],
         has_vectors: bool, *, top: int) -> list[NodeWithScore]:
    """The passages both routes found, best first."""
    retrievers: list[BaseRetriever] = [_Rows(words)]
    found = embedder(local_only=True) if has_vectors else None
    if found is not None:
        retrievers.append(_Rows(lambda q: meaning(q, found)))
    try:
        return QueryFusionRetriever(retrievers, llm=MockLLM(), mode="reciprocal_rerank", num_queries=1,
                                    use_async=False, similarity_top_k=top).retrieve(question)
    except Exception as e:  # a failing model must not take the turn down; words still work
        log.warning("search by meaning skipped: %s: %s", type(e).__name__, str(e)[:200])
        return words(question)


class Vectors:
    """Gives a passage table's passages vectors from the local model, one batch at a time.

    `missing` selects (rowid, excerpt) of passages still without one, given (model, batch size).
    """

    def __init__(self, name: str, session, passages: str, table: str, missing: str, *, background: bool):
        self.name, self.session, self.passages, self.table, self.missing = name, session, passages, table, missing
        self.background = background  # tests turn it off and make vectors when they choose
        self._lock = Lock()

    def soon(self) -> None:
        """Make missing vectors in the background, unless that is off or already under way."""
        if self.background and not self._lock.locked():
            Thread(target=self.pending, kwargs={"wait": False}, daemon=True, name=f"contextlens-embed-{self.name}").start()

    def pending(self, *, wait: bool = True) -> int:
        """Make every missing vector; returns how many were made."""
        if not self._lock.acquire(blocking=wait):
            return 0
        made = 0
        try:
            found = embedder(local_only=True)
            if found is None:
                return 0
            with self.session() as conn:
                conn.execute(f"DELETE FROM {self.table} WHERE passage_id NOT IN (SELECT rowid FROM {self.passages})")
            while True:
                with self.session() as conn:
                    rows = conn.execute(self.missing, (found.model, EMBED_BATCH)).fetchall()
                if not rows:
                    return made
                vectors = found.embeddings.embed_documents([r["excerpt"] for r in rows])
                with self.session() as conn:
                    # A passage rewritten meanwhile has a new text, perhaps under the same rowid: skip it.
                    conn.executemany(f"""INSERT OR REPLACE INTO {self.table} (passage_id, model, vector)
                        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM {self.passages} WHERE rowid = ? AND excerpt = ?)""",
                                     [(r["rowid"], found.model, sqlite_vec.serialize_float32(v), r["rowid"], r["excerpt"])
                                      for r, v in zip(rows, vectors)])
                made += len(rows)
        except Exception as e:
            log.warning("%s vectors not made: %s: %s", self.name, type(e).__name__, str(e)[:200])
            return made
        finally:
            self._lock.release()
