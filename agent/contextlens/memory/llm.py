"""The memory system's own model calls: the "memory" role, with structured replies."""
from __future__ import annotations

from typing import TypeVar

from pydantic import BaseModel

from contextlens import models

from .search import Embedder

T = TypeVar("T", bound=BaseModel)


def structured(schema: type[T], instructions: str, text: str) -> T:
    # Function calling works across the OpenAI-compatible providers; strict JSON schema output does not.
    model = models.chat_model("memory").with_structured_output(schema, method="function_calling")
    return model.invoke([("system", instructions), ("human", text)])


def embedder(*, local_only: bool = False) -> Embedder | None:
    embedding = models.embedding_model(local_only=local_only)
    return Embedder(*embedding) if embedding else None
