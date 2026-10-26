"""SQLite-backed repository for persistent ContextLens memories."""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import cast

from .domain import MemoryRecord, SessionContextMode

DB_PATH = Path(os.environ.get("CONTEXTLENS_DB_PATH", Path(__file__).resolve().parents[2] / "data" / "memory.sqlite3")).resolve()
SEED_PATH = Path(os.environ.get("CONTEXTLENS_SEED_PATH", Path(__file__).resolve().parents[3] / "shared" / "memory-seeds.json")).resolve()


def ensure_memory_store() -> None:
    with _connect() as conn:
        _init_schema(conn)
        seed_memories_if_empty(conn)


def seed_memories_if_empty(conn: sqlite3.Connection | None = None) -> None:
    if conn is None:
        with _connect() as local_conn:
            seed_memories_if_empty(local_conn)
        return

    count = cast(int, conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0])
    if count > 0:
        return

    seeds = json.loads(SEED_PATH.read_text())
    for seed in seeds:
        conn.execute(
            """
            INSERT INTO memories (
              id, title, content, memory_type, confidence, context_scope,
              created_at, updated_at, source_kind, lifecycle_state, deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL)
            """,
            (
                seed["id"],
                seed["title"],
                seed["content"],
                seed["memory_type"],
                seed["confidence"],
                seed["context_scope"],
                seed["created_at"],
                seed["created_at"],
                seed["source_kind"],
            ),
        )
    conn.commit()


def list_memories(include_trashed: bool = False) -> list[MemoryRecord]:
    ensure_memory_store()
    with _connect() as conn:
        rows = conn.execute(
            f"""
            SELECT *
            FROM memories
            {"WHERE lifecycle_state != 'trashed'" if not include_trashed else ""}
            ORDER BY datetime(created_at) DESC
            """
        ).fetchall()
        return [_row_to_memory(conn, row["id"]) for row in rows]


def list_memories_by_ids(memory_ids: list[str]) -> list[MemoryRecord]:
    if not memory_ids:
        return []

    ensure_memory_store()
    with _connect() as conn:
        placeholders = ", ".join("?" for _ in memory_ids)
        rows = conn.execute(
            f"""
            SELECT id
            FROM memories
            WHERE lifecycle_state = 'active'
              AND id IN ({placeholders})
            """,
            memory_ids,
        ).fetchall()
        return [_row_to_memory(conn, row["id"]) for row in rows]


def list_memories_for_context(
    mode: SessionContextMode,
    include_blocked: bool = False,
) -> list[MemoryRecord]:
    ensure_memory_store()
    with _connect() as conn:
        params: list[str] = []
        filters = ["m.lifecycle_state = 'active'"]

        filters.append("(m.context_scope = ? OR m.context_scope = 'general')")
        params.append(mode)

        if not include_blocked:
            filters.append(
                """
                NOT EXISTS (
                  SELECT 1
                  FROM memory_context_rules r
                  WHERE r.memory_id = m.id
                    AND r.context_mode = ?
                    AND r.rule_type = 'block'
                )
                """
            )
            params.append(mode)

        rows = conn.execute(
            f"""
            SELECT m.id
            FROM memories m
            WHERE {" AND ".join(filters)}
            ORDER BY datetime(m.created_at) DESC
            """,
            params,
        ).fetchall()
        return [_row_to_memory(conn, row["id"]) for row in rows]


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          memory_type TEXT NOT NULL,
          confidence TEXT NOT NULL,
          context_scope TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL DEFAULT 'active',
          deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS memory_context_rules (
          memory_id TEXT NOT NULL,
          context_mode TEXT NOT NULL,
          rule_type TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (memory_id, context_mode, rule_type),
          FOREIGN KEY (memory_id) REFERENCES memories(id)
        );

        CREATE TABLE IF NOT EXISTS memory_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          context_mode TEXT,
          thread_id TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (memory_id) REFERENCES memories(id)
        );
        """
    )
    columns = {row[1] for row in conn.execute("PRAGMA table_info(memories)")}
    if "revision" not in columns:
        conn.execute("ALTER TABLE memories ADD COLUMN revision INTEGER NOT NULL DEFAULT 1")
    conn.executescript((Path(__file__).resolve().parents[3] / "shared" / "memory-revisions.sql").read_text())
    conn.commit()


def _row_to_memory(conn: sqlite3.Connection, memory_id: str) -> MemoryRecord:
    row = conn.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
    blocked_rows = conn.execute(
        """
        SELECT context_mode
        FROM memory_context_rules
        WHERE memory_id = ? AND rule_type = 'block'
        ORDER BY context_mode
        """,
        (memory_id,),
    ).fetchall()
    return MemoryRecord(
        id=row["id"],
        revision=row["revision"],
        title=row["title"],
        content=row["content"],
        memory_type=row["memory_type"],
        confidence=row["confidence"],
        context_scope=row["context_scope"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        source_kind=row["source_kind"],
        lifecycle_state=row["lifecycle_state"],
        deleted_at=row["deleted_at"],
        blocked_context_modes=[
            cast(SessionContextMode, blocked_row["context_mode"])
            for blocked_row in blocked_rows
        ],
    )
