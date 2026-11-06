"""The seam between the memory system and what the UI and the request snapshot read and write.

The UI thinks in records with a title and content, and events with a kind. Here a title is what was
going on at the time and content is what was learned. Nothing else in the backend needs this shape.
"""
from __future__ import annotations

import json
from dataclasses import asdict, replace
from datetime import date

from contextlens import config, memory
from contextlens.memory import operations
from contextlens.projects import directory as project_directory

_ACTORS = {"after_turn": "consolidation", "upkeep": "consolidation", "seed": "import", "import": "import"}
_SEED_SCENES = {"work": "工作", "study": "学习", "personal": "生活", "life": "生活"}
_TITLE_FROM_LEARNED = 20
_SOURCE_LABELS = {"said": "你说的", "inferred": "推断", "read": "读到的"}


class Conflict(memory.MemoryError):
    """The memory changed since the caller last read it."""


def records(scope: str = memory.ORDINARY, include_trashed: bool = False) -> list[dict]:
    """Newest first. Facts replaced on a timeline are not listed; `timeline` shows them."""
    return _records_in(operations.visible_scopes(scope), include_trashed)


def library_records(owner: str | None, include_trashed: bool) -> list[dict]:
    """Browse by ownership independently of the scopes used for conversation recall."""
    return _records_in({owner} if owner else None, include_trashed)


def _records_in(scopes: set[str] | None, include_trashed: bool) -> list[dict]:
    _seed_if_new()
    states = {"active", "forgotten"} if include_trashed else {"active"}
    found = [m for m in memory.all_of(memory.Memory) if (scopes is None or m.scope in scopes) and m.state in states]
    activity, names = memory.memory_activity(), _concept_names()
    return [_record(m, activity, names) for m in sorted(found, key=lambda m: m.created_at, reverse=True)]


def one(memory_id: str) -> dict | None:
    found = memory.get(memory.Memory, memory_id)
    return _record(found, memory.memory_activity(), _concept_names()) if found else None


def timeline(memory_id: str) -> list[dict]:
    """The facts this one belongs to, oldest first."""
    return [{"id": m.id, "content": m.learned, "created_at": m.created_at, "current": m.superseded_by is None}
            for m in operations.timeline(memory_id)]


def overview(scope: str) -> dict:
    """What the Lens needs around the memories: where it can look, and what waits on the user."""
    _seed_if_new()
    operations.preset_scenes_if_never_chosen()
    scenes = memory.all_of(memory.Scene)
    return {"projects": [{k: p[k] for k in ("id", "name", "isolated")} for p in project_directory()],
            "scenes": [asdict(s) for s in scenes if s.state == "active"],
            "proposed_scenes": [asdict(s) for s in scenes if s.state == "proposed"],
            "concepts": operations.concepts_in(scope),
            "questions": [asdict(q) for q in operations.open_questions(scope)]}


def create(fields: dict, scope: str, source: memory.Source) -> list[dict]:
    if not str(fields.get("title", "")).strip() or not str(fields.get("content", "")).strip():
        raise memory.MemoryError("A memory needs a title and content.")
    return operations.add_memory(fields["content"], source, scope=scope, situation=fields["title"],
                                 scenes=fields.get("scenes", []), concepts=fields.get("concepts", []))


def revise(memory_id: str, fields: dict, source: memory.Source, expected_revision: int | None = None) -> list[dict]:
    current = memory.get(memory.Memory, memory_id)
    if current is None:
        raise memory.MemoryError("No such memory, or it was deleted for good.")
    revision = memory.memory_activity().get(memory_id, (1, ""))[0]
    if expected_revision is not None and revision != expected_revision:
        raise Conflict("This memory was changed elsewhere. Reload and try again.")
    changed = current
    if fields.get("content") is not None:
        changed = replace(changed, learned=fields["content"].strip())
    if fields.get("title") is not None:
        changed = replace(changed, situation=fields["title"].strip())
    if fields.get("scenes") is not None:
        changed = replace(changed, scenes=fields["scenes"])
    if fields.get("concepts") is not None:
        changed = replace(changed, concepts=operations.concept_ids(fields["concepts"], source))
    if fields.get("always_on") is not None:
        changed = replace(changed, always_on=bool(fields["always_on"]))
    return memory.commit(source, "revised", changed)


def events(memory_id: str | None = None, thread_id: str | None = None, limit: int = 200,
           before_id: int | None = None, scope: str | None = None) -> list[dict]:
    raw = memory.list_events(limit, before_id, memory_id, thread_id, entity="memories", scope=scope)
    return [_event(e) for e in raw]


def changes(raw: list[dict]) -> list[dict]:
    """The memory changes among a batch of events, in the UI's shape."""
    return [_event(e) for e in raw if e["entity"] == "memories"]


def _record(m: memory.Memory, activity: dict, names: dict[str, str]) -> dict:
    revision, updated_at = activity.get(m.id, (1, m.created_at))
    return {"id": m.id, "scope": m.scope, "revision": revision, "title": m.situation or m.learned[:_TITLE_FROM_LEARNED],
            "content": m.learned, "memory_type": "semantic", "confidence": "high" if m.source == "said" else "low",
            "scenes": m.scenes, "concepts": [{"id": c, "name": names[c]} for c in m.concepts if c in names],
            "created_at": m.created_at, "updated_at": updated_at, "source_kind": _SOURCE_LABELS[m.source],
            "lifecycle_state": "active" if m.state == "active" else "trashed", "deleted_at": None,
            "always_on": m.always_on, "check_at": m.check_at,
            "due": bool(m.check_at and m.check_at <= date.today().isoformat())}


def _concept_names() -> dict[str, str]:
    return {c.id: c.name for c in memory.all_of(memory.Concept)}


def _event(e: dict) -> dict:
    return {"id": e["id"], "memory_id": e["entity_id"], "kind": _kind(e), "revision": None,
            "before": _snapshot(e["before"]), "after": _snapshot(e["after"]),
            "actor": _ACTORS.get(e["actor"], e["actor"]), "thread_id": e["thread_id"], "turn": e["turn"],
            "reason": e["reason"], "evidence": e["evidence"], "reverts": e.get("undid"),
            "reverted_by": e.get("reverted_by"), "created_at": e["created_at"]}


def _kind(e: dict) -> str:
    """What a change amounts to, read off the row before and after it."""
    if e["action"] == "purged":
        return "purged"
    before, after = e["before"], e["after"]
    if before is None:
        return "created"
    if after is None or (after["state"] != "active" and before["state"] == "active"):
        return "trashed"
    return "restored" if before["state"] != "active" and after["state"] == "active" else "revised"


def _snapshot(row: dict | None) -> dict | None:
    if row is None:
        return None
    learned = row.get("learned")
    return {"title": (row.get("situation") or (learned or "")[:_TITLE_FROM_LEARNED]) if learned else None,
            "content": learned, "memory_type": "semantic", "confidence": "high" if row["source"] == "said" else "low",
            "scenes": json.loads(row["scenes"]),
            "lifecycle_state": "active" if row["state"] == "active" else "trashed"}


def _seed_if_new() -> None:
    """A store that has never seen a change may start from a local seed file."""
    if memory.list_events(limit=1):
        return
    try:
        seeds = json.loads(config.seed_path().read_text())
    except FileNotFoundError:
        return
    for seed in seeds:
        scene = _SEED_SCENES.get(seed["context_scope"])
        operations.add_memory(seed["content"], memory.Source("seed"), situation=seed["title"],
                              scenes=[scene] if scene else [])
