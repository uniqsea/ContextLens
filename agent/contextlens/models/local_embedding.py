"""The embedding model that needs no key and sends nothing anywhere: Qwen3-Embedding-0.6B run on this
machine with fastembed (ONNX, no torch). It is fetched once by `npm run setup`; a turn never downloads
anything, so without the file, search is keywords only.
"""
from __future__ import annotations

import logging
from functools import cache

from langchain_core.embeddings import Embeddings

from contextlens import config

log = logging.getLogger(__name__)
MODEL = "Qwen/Qwen3-Embedding-0.6B"
# The model's own prompt for a query; documents go in bare.
_QUERY = "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery:"
_BATCH = 8  # a padded batch costs memory by its longest text; the default 256 would spike on long documents


class LocalEmbeddings(Embeddings):
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [vector.tolist() for vector in _model().embed(texts, batch_size=_BATCH)]

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([_QUERY + text])[0]


def available() -> tuple[str, Embeddings] | None:
    """("local/model", client), or None when the model file is not here."""
    try:
        _model()
    except Exception as e:
        log.warning("no local embedding model, keywords only: %s", str(e)[:200])
        return None
    return f"local/{MODEL}", LocalEmbeddings()


def fetch() -> None:
    """Download the model file if it is not here yet."""
    _load(local_files_only=False)


@cache
def _model():
    return _load(local_files_only=True)


def _load(*, local_files_only: bool):
    from fastembed import TextEmbedding

    return TextEmbedding(MODEL, cache_dir=str(config.ensure_home() / "models"), local_files_only=local_files_only)
