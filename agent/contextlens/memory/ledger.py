"""Every change goes through here: events appended, current state and search index updated, in one
transaction. Changes made together form a batch and are undone together. Undoing is a new change
that puts things back; the history stays. Only `purge` rewrites history, and only to erase content.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import replace
from datetime import datetime, timezone

from . import search
from .store import EVENT_ROW, TABLES, event_dict, from_row, session, to_row
from .types import Entity, Memory, MemoryError, Source

_BY_NAME = {table: cls for cls, table in TABLES.items()}
_batch: ContextVar[str | None] = ContextVar("batch", default=None)


@contextmanager
def together():
    """Changes committed inside form one batch, undone in one go."""
    token = _batch.set(uuid.uuid4().hex)
    try:
        yield
    finally:
        _batch.reset(token)


def commit(source: Source, action: str, *entities: Entity, alone: bool = False) -> list[dict]:
    """Write these entities as they now should be; ones that did not change are left out. `alone` keeps
    them out of any batch being gathered."""
    batch = None if alone else _batch.get()
    with session() as conn:
        return _apply(conn, source, action, batch or uuid.uuid4().hex,
                      [(TABLES[type(e)], e.id, to_row(e)) for e in entities])


def revert(event_id: int, source: Source) -> list[dict]:
    """Undo the batch this event belongs to, provided nothing has changed its entities since."""
    with session() as conn:
        row = conn.execute("SELECT batch FROM events WHERE id = ?", (event_id,)).fetchone()
        if row is None:
            raise MemoryError("No such change.")
        batch = row["batch"]
        if conn.execute("SELECT 1 FROM events WHERE reverts = ?", (batch,)).fetchone():
            raise MemoryError("This change has already been undone.")
        events = [event_dict(r) for r in conn.execute(
            "SELECT * FROM events WHERE batch = ? ORDER BY id DESC", (batch,))]
        for event in events:
            if _current(conn, event["entity"], event["entity_id"]) != event["after"]:
                raise MemoryError("This has changed since; undo the later change first.")
        return _apply(conn, source, "reverted", uuid.uuid4().hex,
                      [(e["entity"], e["entity_id"], e["before"]) for e in events], reverts=batch)


def purge(memory_id: str, source: Source) -> list[dict]:
    """Delete for good: the content is blanked out of every past event, and this cannot be undone."""
    with session() as conn:
        if _current(conn, "memories", memory_id) is None:
            raise MemoryError("No such memory, or it was deleted for good.")
        for row in conn.execute("SELECT id, before, after FROM events WHERE entity_id = ?", (memory_id,)).fetchall():
            conn.execute("UPDATE events SET before = ?, after = ?, evidence = NULL, reason = NULL WHERE id = ?",
                         (_blank(row["before"]), _blank(row["after"]), row["id"]))
        trace = replace(source, reason=None, evidence=None)
        return _apply(conn, trace, "purged", uuid.uuid4().hex, [("memories", memory_id, None)], keep_snapshot=False)


def _apply(conn: sqlite3.Connection, source: Source, action: str, batch: str, writes: list, *,
           reverts: str | None = None, keep_snapshot: bool = True) -> list[dict]:
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    events = []
    for table, entity_id, after in writes:
        before = _current(conn, table, entity_id)
        if before == after:
            continue
        _write(conn, table, entity_id, after)
        if table == "memories":
            search.index(conn, from_row(Memory, after) if after else None, entity_id)
        cursor = conn.execute(
            "INSERT INTO events (batch, entity, entity_id, action, before, after, actor, thread_id, turn, reason, "
            "evidence, reverts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (batch, table, entity_id, action, _dump(before) if keep_snapshot else None, _dump(after), source.actor,
             source.thread_id, source.turn, source.reason, source.evidence, reverts, now))
        row = conn.execute(f"{EVENT_ROW} WHERE e.id = ?", (cursor.lastrowid,)).fetchone()
        events.append(event_dict(row))
    return events


def _write(conn, table: str, entity_id: str, row: dict | None) -> None:
    if row is None:
        conn.execute(f"DELETE FROM {table} WHERE id = ?", (entity_id,))
        return
    columns = ", ".join(row)
    conn.execute(f"INSERT OR REPLACE INTO {table} ({columns}) VALUES ({', '.join('?' * len(row))})",
                 tuple(row.values()))


def _current(conn, table: str, entity_id: str) -> dict | None:
    row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (entity_id,)).fetchone()
    return dict(row) if row else None


def _blank(raw: str | None) -> str | None:
    return json.dumps({**json.loads(raw), "learned": None, "situation": None}) if raw else raw


def _dump(value: dict | None) -> str | None:
    return json.dumps(value, ensure_ascii=False) if value else None
