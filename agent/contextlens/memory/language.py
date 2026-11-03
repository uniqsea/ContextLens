"""The one language memories are written in, so the library reads as one whole whatever language each
conversation was in. The user picks it, or it follows the interface. When it changes, what is already
there is rewritten in the background, each change an ordinary event the user can undo.
"""
from __future__ import annotations

import logging
import threading

from pydantic import BaseModel

from contextlens.models import settings

from . import llm, operations
from .store import all_of, memories_in, session
from .types import ORDINARY, MemoryError, Project, Source

log = logging.getLogger(__name__)
_NAMES = {"zh": "Simplified Chinese", "en": "English"}
_REASONS = {"zh": "改写为中文", "en": "Rewritten in English"}
_BATCH = 40
_lock = threading.Lock()

_INSTRUCTIONS = """You rewrite an assistant's memories about its user in {language}. For each, give learned
and situation in {language}, saying exactly what the original says: nothing added or left out, and no
more or less certain. Keep the names of people, projects, works and organisations as they are. Leave
text already in {language} word for word, and an empty situation empty."""


class Rewritten(BaseModel):
    id: str
    learned: str
    situation: str = ""


class Rewrites(BaseModel):
    memories: list[Rewritten]


def current() -> str:
    saved = settings.read()["memory_language"]
    return saved["choice"] if saved["choice"] in settings.LANGUAGES else saved["interface"]


def name() -> str:
    """The language's name as the model prompts say it."""
    return _NAMES[current()]


def state() -> dict:
    return {**settings.read()["memory_language"], "current": current(), "rewriting": _lock.locked()}


def choose(choice: str | None = None, interface: str | None = None) -> dict:
    """Save the user's choice or the interface language just seen; if memories should now be in
    another language, rewrite them in the background."""
    settings.set_memory_language(choice, interface)
    if _written() != current():
        threading.Thread(target=_guarded, daemon=True).start()
    return state()


def rewrite() -> list[dict]:
    """Rewrite every active memory in the current language; returns the events."""
    target = current()
    memories = memories_in({ORDINARY, *(p.id for p in all_of(Project))})
    source = Source("upkeep", reason=_REASONS[target])
    events = []
    for i in range(0, len(memories), _BATCH):
        batch = {m.id: m for m in memories[i:i + _BATCH]}
        listing = "\n".join(f"[{m.id}] learned: {m.learned}\n    situation: {m.situation}" for m in batch.values())
        found = llm.structured(Rewrites, _INSTRUCTIONS.format(language=_NAMES[target]), listing).memories
        for r in found:
            m = batch.get(r.id)
            if m is None:
                continue
            changes = {k: v.strip() for k, v in (("learned", r.learned), ("situation", r.situation))
                       if v.strip() and v.strip() != getattr(m, k)}
            try:
                events += operations.revise(m.id, changes, source) if changes else []
            except MemoryError as e:  # undone or deleted meanwhile
                log.info("memory not rewritten: %s", e)
    with session() as conn:
        conn.execute("INSERT OR REPLACE INTO marks (key, value) VALUES ('language', ?)", (target,))
    return events


def _guarded() -> None:
    if not _lock.acquire(blocking=False):
        return
    try:
        # The choice may change again while a pass runs.
        while _written() != current():
            rewrite()
    except Exception as e:  # background work has nobody to report to but the log; retried on the next choice
        log.warning("rewriting memories failed: %s: %s", type(e).__name__, str(e)[:300])
    finally:
        _lock.release()


def _written() -> str | None:
    with session() as conn:
        row = conn.execute("SELECT value FROM marks WHERE key = 'language'").fetchone()
    return row["value"] if row else None
