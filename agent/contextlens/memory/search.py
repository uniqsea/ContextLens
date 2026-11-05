"""How close a memory's text is to a query, as a score from 0 to 1 that means the same every time.

Two routes: shared words (jieba, so Chinese, English and mixed text all work) weighted by how rare
they are, and meaning (sqlite-vec) when an embedding model is set. Scores stay absolute rather than
rank fused, because recall compares them across fields and against a threshold.

Every memory is indexed on two fields: what was learned, and what was going on at the time.
"""
from __future__ import annotations

import logging
import math
import re
import sqlite3
from collections import Counter
from collections.abc import Iterable
from functools import cache
from threading import Lock
from typing import Literal, NamedTuple

import jieba
import jieba.analyse
import sqlite_vec
from langchain_core.embeddings import Embeddings
from stop_words import get_stop_words

from .types import Memory

jieba.setLogLevel(logging.WARNING)
log = logging.getLogger(__name__)

Field = Literal["learned", "situation"]
_FIELDS: tuple[Field, ...] = ("learned", "situation")
_RARE_TERMS = 3  # a query is fully covered by matching this many of its rarest words
# Cosine below the floor is noise (with the local Qwen3-Embedding-0.6B, 99% of off-topic pairs score
# under 0.24); at the ceiling two texts say about the same thing, including across languages (its
# paraphrases all score above 0.62). A different model needs these checked again.
_COS_FLOOR, _COS_CEILING = 0.25, 0.6
_WORD = re.compile(r"[\w一-鿿]", re.UNICODE)
_STOP = frozenset(jieba.analyse.default_tfidf.stop_words) | frozenset(get_stop_words("chinese"))
_query_vectors: dict[tuple[str, str], list[float]] = {}


class Embedder(NamedTuple):
    model: str  # "provider/model": vectors from different models never mix
    embeddings: Embeddings


_vector_lock = Lock()


@cache
def tokenizer():
    # Each caller holds its tokenizer until the current operation finishes.
    return jieba.Tokenizer()


def release_caches():
    tokenizer.cache_clear()
    with _vector_lock:
        _query_vectors.clear()


def tokens(text: str) -> list[str]:
    return [t for t in tokenizer().cut_for_search(text.lower())
            if _WORD.search(t) and t not in _STOP and not (len(t) == 1 and t.isascii())]


def index(conn: sqlite3.Connection, memory: Memory | None, memory_id: str) -> None:
    """Keep a memory's words in step with it; a changed text's vector is redone on the next search."""
    conn.execute("DELETE FROM memory_terms WHERE memory_id = ?", (memory_id,))
    if memory is None:
        conn.execute("DELETE FROM memory_vectors WHERE memory_id = ?", (memory_id,))
        return
    conn.executemany("INSERT INTO memory_terms (memory_id, field, terms) VALUES (?, ?, ?)",
                     [(memory_id, f, " ".join(tokens(getattr(memory, f)))) for f in _FIELDS])


def similarity(conn: sqlite3.Connection, query: str, field: Field, among: Iterable[Memory],
               embedder: Embedder | None = None) -> dict[str, float]:
    """Score per memory that resembles the query at all; the rest are left out."""
    memories = list(among)
    if not query.strip() or not memories:
        return {}
    scores = _words(conn, query, field, [m.id for m in memories])
    if embedder is not None:
        try:
            for memory_id, score in _meaning(conn, query, field, memories, embedder).items():
                scores[memory_id] = max(score, scores.get(memory_id, 0.0))
        except Exception as e:  # a provider hiccup must not take the turn down; words still work
            log.warning("vector search skipped: %s: %s", type(e).__name__, str(e)[:200])
    return scores


def _words(conn, query: str, field: Field, ids: list[str]) -> dict[str, float]:
    marks = ", ".join("?" * len(ids))
    docs = {r["memory_id"]: set(r["terms"].split()) for r in conn.execute(
        f"SELECT memory_id, terms FROM memory_terms WHERE field = ? AND memory_id IN ({marks})", (field, *ids))}
    seen = Counter(term for terms in docs.values() for term in terms)
    weight = {t: math.log(1 + len(docs) / seen[t]) for t in set(tokens(query)) if seen[t]}
    if not weight:
        return {}
    full = sum(sorted(weight.values(), reverse=True)[:_RARE_TERMS])
    scores = {mid: min(1.0, sum(w for t, w in weight.items() if t in terms) / full) for mid, terms in docs.items()}
    return {mid: s for mid, s in scores.items() if s > 0}


def _meaning(conn, query: str, field: Field, memories: list[Memory], embedder: Embedder) -> dict[str, float]:
    _embed_missing(conn, field, memories, embedder)
    marks = ", ".join("?" * len(memories))
    rows = conn.execute(
        f"SELECT memory_id, vec_distance_cosine(vector, ?) AS distance FROM memory_vectors "
        f"WHERE field = ? AND model = ? AND memory_id IN ({marks})",
        (sqlite_vec.serialize_float32(_query_vector(query.strip(), embedder)), field, embedder.model,
         *[m.id for m in memories])).fetchall()
    span = _COS_CEILING - _COS_FLOOR
    return {r["memory_id"]: min(1.0, (1 - r["distance"] - _COS_FLOOR) / span)
            for r in rows if 1 - r["distance"] > _COS_FLOOR}


def _embed_missing(conn, field: Field, memories: list[Memory], embedder: Embedder) -> None:
    held = {r["memory_id"]: r["text"] for r in conn.execute(
        "SELECT memory_id, text FROM memory_vectors WHERE field = ? AND model = ?", (field, embedder.model))}
    stale = [m for m in memories if getattr(m, field).strip() and held.get(m.id) != getattr(m, field)]
    if not stale:
        return
    texts = [getattr(m, field) for m in stale]
    conn.executemany(
        "INSERT OR REPLACE INTO memory_vectors (memory_id, field, model, text, vector) VALUES (?, ?, ?, ?, ?)",
        [(m.id, field, embedder.model, t, sqlite_vec.serialize_float32(v))
         for m, t, v in zip(stale, texts, embedder.embeddings.embed_documents(texts))])
    conn.commit()


def _query_vector(query: str, embedder: Embedder) -> list[float]:
    key = (embedder.model, query)
    with _vector_lock:
        vector = _query_vectors.get(key)
    if vector is None:
        vector = embedder.embeddings.embed_query(query)
        with _vector_lock:
            _query_vectors[key] = vector
            if len(_query_vectors) > 512:
                del _query_vectors[next(iter(_query_vectors))]
    return vector
