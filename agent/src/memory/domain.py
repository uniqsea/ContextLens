"""Core memory-domain types shared by repository and agent mapping."""

from __future__ import annotations

from typing import Literal, TypedDict

MemoryType = Literal["semantic", "episodic", "procedural"]
MemoryConfidence = Literal["high", "low"]
MemoryLifecycleState = Literal["active", "trashed"]
SessionContextMode = Literal["study", "work", "personal", "life", "general"]
MemorySourceKind = Literal["seed", "user", "system"]
MemoryEventType = Literal["temporary_ignore", "context_block", "delete_forever"]


class MemoryRecord(TypedDict):
    revision: int
    id: str
    title: str
    content: str
    memory_type: MemoryType
    confidence: MemoryConfidence
    context_scope: SessionContextMode
    created_at: str
    updated_at: str
    source_kind: MemorySourceKind
    lifecycle_state: MemoryLifecycleState
    deleted_at: str | None
    blocked_context_modes: list[SessionContextMode]


class MemoryContextRule(TypedDict):
    memory_id: str
    context_mode: SessionContextMode
    rule_type: Literal["block"]


class MemoryEvent(TypedDict):
    memory_id: str
    event_type: MemoryEventType
    context_mode: SessionContextMode | None
    thread_id: str | None
    created_at: str
