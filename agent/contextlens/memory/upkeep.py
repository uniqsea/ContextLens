"""Background tidying, one scope at a time, by the memory model. It sees only that scope, so nothing
crosses a boundary by accident. Every change is an ordinary event the user can undo. When the evidence
does not settle something, it asks instead of picking a side.
"""
from __future__ import annotations

import logging
import threading
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

from . import llm, operations
from .store import get, memories_in, session
from .types import ORDINARY, MemoryError, Project, Source

log = logging.getLogger(__name__)
_NEW_MEMORIES_BEFORE_RUN = 5
_SHOWN = 150
_lock = threading.Lock()

_INSTRUCTIONS = """You tidy the long-term memory of a personal assistant. List only the changes that are
clearly needed; often there are none. Each needs a short reason, in the language of the memories.
- merge: two concepts are one thing under two names. keep_id, drop_id.
- supersede: the world changed: a memory was true, and a later one replaces it. memory_id, by_id.
- correct: a memory is wrong and the others prove it. memory_id, text.
- ask: two memories cannot both be true at the same time and the evidence does not settle which, or a
  memory marked due can't be judged from what is here. text is the question for the user, memory_ids
  what it concerns. Before calling something a contradiction, check it: several roles at once are
  fine, one role after another is a timeline, and similar-looking facts may be about two things.
- always_on: a memory is true whatever is going on and bears on nearly anything, or a memory marked as
  such does not. Very few qualify; a preference that depends on the task does not. memory_id, value.
- recheck: a memory marked due still holds. memory_id, date (ISO), or leave date empty if it no longer
  depends on time.
- distill: only when told it is allowed. Something from this project holds beyond it. text, memory_ids."""


class Step(BaseModel):
    op: Literal["merge", "supersede", "correct", "ask", "always_on", "recheck", "distill"]
    reason: str
    keep_id: str | None = None
    drop_id: str | None = None
    memory_id: str | None = None
    by_id: str | None = None
    text: str | None = None
    memory_ids: list[str] = Field(default_factory=list)
    value: bool | None = None
    date: str | None = None


class Plan(BaseModel):
    steps: list[Step]


def run_if_due(scope: str) -> None:
    """Enough has been written in this scope since the last run: tidy it in the background."""
    with session() as conn:
        count = conn.execute("SELECT COUNT(*) FROM memories WHERE scope = ? AND rowid > ?",
                             (scope, _last_seen(conn, scope))).fetchone()[0]
    if count >= _NEW_MEMORIES_BEFORE_RUN:
        threading.Thread(target=_guarded, args=(scope,), daemon=True).start()


def run(scope: str) -> list[dict]:
    """One pass over a scope; returns its events."""
    memories = memories_in({scope})[:_SHOWN]
    with session() as conn:
        mark = conn.execute("SELECT COALESCE(MAX(rowid), 0) FROM memories").fetchone()[0]
    if not memories:
        return []
    today = date.today().isoformat()
    concepts = operations.concepts_in(scope)
    project = get(Project, scope) if scope != ORDINARY else None
    may_distill = project is not None and not project.isolated
    listing = "\n".join(
        f"[{m.id}] {m.learned} (noted {m.created_at[:10]}"
        f"{', while ' + m.situation if m.situation else ''}"
        f"{', ALWAYS ON' if m.always_on else ''}"
        f"{', DUE' if m.check_at and m.check_at <= today else ''})" for m in memories)
    names = "\n".join(f"[{c['id']}] {' / '.join([c['name'], *c['aliases']])}" for c in concepts)
    prompt = (f"Today: {today}\nDistilling is {'allowed' if may_distill else 'not allowed'}.\n\n"
              f"Concepts:\n{names or 'none'}\n\nMemories:\n{listing}")
    plan = llm.structured(Plan, _INSTRUCTIONS, prompt)
    shown, shown_concepts = {m.id for m in memories}, {c["id"] for c in concepts}
    events = []
    for step in plan.steps:
        try:
            events += _apply(step, scope, shown, shown_concepts, may_distill)
        except MemoryError as e:
            log.info("upkeep step not applied: %s", e)
    with session() as conn:
        conn.execute("INSERT OR REPLACE INTO marks (key, value) VALUES (?, ?)", (f"upkeep:{scope}", mark))
    return events


def _apply(step: Step, scope: str, shown: set[str], concepts: set[str], may_distill: bool) -> list[dict]:
    """The model may only touch what it was shown."""
    source = Source("upkeep", reason=step.reason)
    op = step.op
    if op == "merge" and {step.keep_id, step.drop_id} <= concepts:
        return operations.merge_concepts(step.keep_id, step.drop_id, source)
    if op == "supersede" and {step.memory_id, step.by_id} <= shown:
        return operations.supersede_with(step.memory_id, step.by_id, source)
    if op == "correct" and step.memory_id in shown and step.text:
        return operations.revise(step.memory_id, {"learned": step.text}, source)
    if op == "ask" and step.text:
        return operations.ask(step.text, scope, [i for i in step.memory_ids if i in shown], source)
    if op == "always_on" and step.memory_id in shown and step.value is not None:
        return operations.revise(step.memory_id, {"always_on": step.value}, source)
    if op == "recheck" and step.memory_id in shown:
        return operations.revise(step.memory_id, {"check_at": step.date}, source)
    if op == "distill" and may_distill and step.text:
        origin = ", ".join(i for i in step.memory_ids if i in shown)
        return operations.add_memory(step.text, Source("upkeep", reason=step.reason, evidence=origin),
                                     origin="inferred", situation=f"distilled from project {scope}")
    return []


def _guarded(scope: str) -> None:
    if not _lock.acquire(blocking=False):
        return
    try:
        run(scope)
    except Exception as e:  # background work has nobody to report to but the log
        log.warning("upkeep failed for %s: %s: %s", scope, type(e).__name__, str(e)[:300])
    finally:
        _lock.release()


def _last_seen(conn, scope: str) -> int:
    row = conn.execute("SELECT value FROM marks WHERE key = ?", (f"upkeep:{scope}",)).fetchone()
    return row["value"] if row else 0
