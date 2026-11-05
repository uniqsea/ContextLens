"""SQLite storage: one table per entity, an append-only event log, and the search index.

Entities are read here and written only by `ledger`. Short lists live as JSON in their row:
at the scale of one person's memory, ranking happens in Python over what the scope can see.
"""
from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict, fields
from typing import TypeVar

import sqlite_vec

from contextlens import config

from .types import Concept, Entity, Memory, Project, Question, Scene

_SCHEMA = """
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, learned TEXT NOT NULL, situation TEXT NOT NULL,
  source TEXT NOT NULL, concepts TEXT NOT NULL, scenes TEXT NOT NULL, state TEXT NOT NULL,
  always_on INTEGER NOT NULL, check_at TEXT, superseded_by TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS memories_by_scope ON memories(scope, state);
CREATE TABLE IF NOT EXISTS concepts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, aliases TEXT NOT NULL, part_of TEXT, merged_into TEXT);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, definition TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, reason TEXT);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, isolated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS removed_projects (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS project_settings (
  project_id TEXT PRIMARY KEY, starred INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '', updated_at TEXT);
CREATE TABLE IF NOT EXISTS project_folders (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, path TEXT NOT NULL, device INTEGER NOT NULL,
  inode TEXT NOT NULL, UNIQUE(project_id, path));
CREATE TABLE IF NOT EXISTS project_documents (
  id INTEGER PRIMARY KEY, folder_id TEXT NOT NULL, path TEXT NOT NULL, stamp TEXT NOT NULL,
  UNIQUE(folder_id, path));
CREATE VIRTUAL TABLE IF NOT EXISTS project_passages USING fts5(document_id UNINDEXED, name, terms, excerpt UNINDEXED);
CREATE TRIGGER IF NOT EXISTS remove_project_passages AFTER DELETE ON project_documents BEGIN
  DELETE FROM project_passages WHERE document_id = OLD.id;
END;
CREATE TRIGGER IF NOT EXISTS remove_project_documents AFTER DELETE ON project_folders BEGIN
  DELETE FROM project_documents WHERE folder_id = OLD.id;
END;
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, text TEXT NOT NULL, memory_ids TEXT NOT NULL,
  state TEXT NOT NULL, answer TEXT);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, batch TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  action TEXT NOT NULL, before TEXT, after TEXT, actor TEXT NOT NULL, thread_id TEXT, turn INTEGER,
  reason TEXT, evidence TEXT, reverts TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_by_entity ON events(entity, entity_id);
CREATE INDEX IF NOT EXISTS events_by_batch ON events(batch);
CREATE TABLE IF NOT EXISTS memory_terms (
  memory_id TEXT NOT NULL, field TEXT NOT NULL, terms TEXT NOT NULL, PRIMARY KEY (memory_id, field));
CREATE TABLE IF NOT EXISTS memory_vectors (
  memory_id TEXT NOT NULL, field TEXT NOT NULL, model TEXT NOT NULL, text TEXT NOT NULL, vector BLOB NOT NULL,
  PRIMARY KEY (memory_id, field, model));
CREATE TABLE IF NOT EXISTS marks (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
"""

TABLES: dict[type, str] = {Memory: "memories", Concept: "concepts", Scene: "scenes", Project: "projects",
                           Question: "questions"}
_LISTS = {"concepts", "scenes", "aliases", "memory_ids"}
_FLAGS = {"always_on", "isolated"}
E_ = TypeVar("E_", Memory, Concept, Scene, Project, Question)


def connect() -> sqlite3.Connection:
    path = config.db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    conn.executescript(_SCHEMA)
    if "definition" not in {r["name"] for r in conn.execute("PRAGMA table_info(scenes)")}:  # stores made before it
        conn.execute("ALTER TABLE scenes ADD COLUMN definition TEXT NOT NULL DEFAULT ''")
    if "updated_at" not in {r["name"] for r in conn.execute("PRAGMA table_info(project_settings)")}:
        conn.execute("ALTER TABLE project_settings ADD COLUMN updated_at TEXT")
    return conn


@contextmanager
def session() -> Iterator[sqlite3.Connection]:
    """One connection: committed if the block succeeds, rolled back if it raises, always closed."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def to_row(entity: Entity) -> dict:
    return {k: json.dumps(v, ensure_ascii=False) if k in _LISTS else int(v) if k in _FLAGS else v
            for k, v in asdict(entity).items()}


def from_row(cls: type[E_], row) -> E_:
    names = {f.name for f in fields(cls)}
    return cls(**{k: json.loads(row[k]) if k in _LISTS else bool(row[k]) if k in _FLAGS else row[k]
                  for k in row.keys() if k in names})


def all_of(cls: type[E_], conn: sqlite3.Connection | None = None) -> list[E_]:
    if conn is None:
        with session() as own:
            return all_of(cls, own)
    return [from_row(cls, r) for r in conn.execute(f"SELECT * FROM {TABLES[cls]}")]


def get(cls: type[E_], entity_id: str, conn: sqlite3.Connection | None = None) -> E_ | None:
    if conn is None:
        with session() as own:
            return get(cls, entity_id, own)
    row = conn.execute(f"SELECT * FROM {TABLES[cls]} WHERE id = ?", (entity_id,)).fetchone()
    return from_row(cls, row) if row else None


def memories_in(scopes: set[str], conn: sqlite3.Connection | None = None) -> list[Memory]:
    """Active memories of the given scopes, newest first."""
    if conn is None:
        with session() as own:
            return memories_in(scopes, own)
    marks = ", ".join("?" * len(scopes))
    return [from_row(Memory, r) for r in conn.execute(
        f"SELECT * FROM memories WHERE scope IN ({marks}) AND state = 'active' ORDER BY created_at DESC, id",
        tuple(scopes))]


EVENT_ROW = ("SELECT e.*, (SELECT MIN(r.id) FROM events r WHERE r.reverts = e.batch) AS reverted_by, "
             "(SELECT MIN(o.id) FROM events o WHERE o.batch = e.reverts) AS undid FROM events e")


def list_events(limit: int = 100, before_id: int | None = None, entity_id: str | None = None,
                thread_id: str | None = None, entity: str | None = None, scope: str | None = None) -> list[dict]:
    """Newest first, each with the first event that undid its batch and the first it undid."""
    where, params = ["1 = 1"], []
    for clause, value in (("e.id < ?", before_id), ("e.entity_id = ?", entity_id), ("e.thread_id = ?", thread_id),
                          ("e.entity = ?", entity),
                          ("e.entity_id IN (SELECT id FROM memories WHERE scope = ?)", scope)):
        if value is not None:
            where.append(clause)
            params.append(value)
    with session() as conn:
        rows = conn.execute(
            f"{EVENT_ROW} WHERE {' AND '.join(where)} ORDER BY e.id DESC LIMIT ?", (*params, limit)).fetchall()
    return [event_dict(r) for r in rows]


def memory_activity() -> dict[str, tuple[int, str]]:
    """Per memory: how many changes it has seen, and when the last was."""
    with session() as conn:
        return {r["entity_id"]: (r["n"], r["at"]) for r in conn.execute(
            "SELECT entity_id, COUNT(*) AS n, MAX(created_at) AS at FROM events WHERE entity = 'memories' "
            "GROUP BY entity_id")}


def event_dict(row) -> dict:
    event = dict(row)
    for key in ("before", "after"):
        event[key] = json.loads(event[key]) if event[key] else None
    return event
