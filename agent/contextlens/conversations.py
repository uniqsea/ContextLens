"""The conversation list: one row per conversation, beside its checkpoints in conversations.sqlite3.

A conversation's id is its LangGraph thread id: its content is the thread's checkpoints, and memory
changes it caused carry the same id. The row holds what the list shows and what it is filed under:
the project (none for an ordinary conversation), the title, whether it is archived, a preview of the
last answer, what its last request was made of, and when it was started and last answered.

Beside it, `source_uses` keeps which sources each answered turn carried, so a memory can say how
often it has been used and when last.
"""
from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone

from contextlens.config import conversations_path
from contextlens.provenance import strip_markers

ORDINARY = "ordinary"
TITLE_LENGTH = 100
PREVIEW_LENGTH = 200

_SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, project_id TEXT, title TEXT NOT NULL DEFAULT '', titled INTEGER NOT NULL DEFAULT 0,
  preview TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS conversations_by_project ON conversations(project_id, updated_at);
CREATE TABLE IF NOT EXISTS conversation_marks (key TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS source_uses (
  conversation_id TEXT NOT NULL, turn INTEGER NOT NULL, source_id TEXT NOT NULL, used_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, turn, source_id));
CREATE INDEX IF NOT EXISTS source_uses_by_source ON source_uses(source_id);
"""
# What a request is made of, in the order it is drawn.
_LAYERS = ("system", "memory", "retrieval", "short_term", "user")


@contextmanager
def _session() -> Iterator[sqlite3.Connection]:
    path = conversations_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(_SCHEMA)
        if "mix" not in {r["name"] for r in conn.execute("PRAGMA table_info(conversations)")}:
            conn.execute("ALTER TABLE conversations ADD COLUMN mix TEXT NOT NULL DEFAULT ''")
        with conn:
            yield conn
    finally:
        conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _project(scope: str | None) -> str | None:
    return None if not scope or scope == ORDINARY else scope


def _shape(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "scope": row["project_id"] or ORDINARY, "title": row["title"],
            "preview": row["preview"], "archived": bool(row["archived"]),
            "mix": json.loads(row["mix"]) if row["mix"] else None,
            "created_at": row["created_at"], "updated_at": row["updated_at"]}


def create(conversation_id: str, scope: str | None) -> dict:
    now = _now()
    with _session() as conn:
        conn.execute("INSERT INTO conversations (id, project_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
                     (conversation_id, _project(scope), now, now))
        return _shape(conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone())


def get(conversation_id: str) -> dict | None:
    with _session() as conn:
        row = conn.execute("SELECT * FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
    return _shape(row) if row else None


def listing(scope: str | None = None) -> list[dict]:
    """Newest activity first; every conversation, or one project's (or the ordinary ones)."""
    query, params = "SELECT * FROM conversations", ()
    if scope is not None:
        query, params = "SELECT * FROM conversations WHERE project_id IS ?", (_project(scope),)
    with _session() as conn:
        return [_shape(r) for r in conn.execute(query + " ORDER BY updated_at DESC", params)]


def rename(conversation_id: str, title: str) -> dict | None:
    with _session() as conn:
        conn.execute("UPDATE conversations SET title = ?, titled = 1 WHERE id = ?",
                     (title.strip()[:TITLE_LENGTH], conversation_id))
    return get(conversation_id)


def set_archived(conversation_id: str, archived: bool) -> dict | None:
    with _session() as conn:
        conn.execute("UPDATE conversations SET archived = ? WHERE id = ?", (int(archived), conversation_id))
    return get(conversation_id)


def delete(conversation_id: str) -> None:
    with _session() as conn:
        conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
        conn.execute("DELETE FROM source_uses WHERE conversation_id = ?", (conversation_id,))


def request_sources(version: dict, question: str) -> list[dict]:
    """What one answer's request carried, from its recorded version: the system prompt, each source
    it assembled, and the question. Sizes are the same token estimates the interface shows."""
    by_id = {c["id"]: c for c in version.get("candidates", [])}
    sent = version.get("assembled_ids") or version.get("selected_ids") or []
    system = next((c for c in by_id.values() if c.get("layer") == "system"), None)
    picked = [by_id[i] for i in sent if by_id.get(i, {}).get("layer") in ("memory", "retrieval", "short_term")]
    return ([{"id": system["id"] if system else "sys-001", "layer": "system",
              "tokens": system.get("tokens", 100) if system else 100}]
            + [{"id": c["id"], "layer": c["layer"], "tokens": c.get("tokens", 0)} for c in picked]
            + [{"id": "usr-001", "layer": "user", "tokens": max(12, round(len(question) * 1.3))}])


def record_sources(conversation_id: str | None, turn: int, sources: list[dict], at: str | None = None) -> None:
    """The sources a turn's latest answer carried, replacing what an earlier version of it did; the
    conversation's mix becomes this request's: tokens and item count per kind."""
    if not conversation_id:
        return
    mix = {layer: [sum(s["tokens"] for s in sources if s["layer"] == layer),
                   sum(1 for s in sources if s["layer"] == layer)] for layer in _LAYERS}
    with _session() as conn:
        conn.execute("DELETE FROM source_uses WHERE conversation_id = ? AND turn = ?", (conversation_id, turn))
        conn.executemany("INSERT OR IGNORE INTO source_uses VALUES (?, ?, ?, ?)",
                         [(conversation_id, turn, s["id"], at or _now()) for s in sources
                          if s["layer"] not in ("system", "user")])
        conn.execute("UPDATE conversations SET mix = ? WHERE id = ?", (json.dumps(mix), conversation_id))


def uses() -> dict[str, tuple[int, str]]:
    """Per source: in how many answered turns it was carried, and when last."""
    with _session() as conn:
        return {r["source_id"]: (r["n"], r["last"]) for r in conn.execute(
            "SELECT source_id, COUNT(*) AS n, MAX(used_at) AS last FROM source_uses GROUP BY source_id")}


def mark(key: str) -> None:
    with _session() as conn:
        conn.execute("INSERT OR IGNORE INTO conversation_marks (key) VALUES (?)", (key,))


def record_turn(conversation_id: str | None, scope: str | None, question: str, answer: str) -> None:
    """An answered turn: the conversation moves up the list, shows the answer, and is titled by its
    first question unless the user named it. A conversation made elsewhere is filed here on its first turn."""
    if not conversation_id:
        return
    now = _now()
    with _session() as conn:
        conn.execute("INSERT OR IGNORE INTO conversations (id, project_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
                     (conversation_id, _project(scope), now, now))
        conn.execute("""UPDATE conversations SET updated_at = ?, preview = ?,
                            title = CASE WHEN titled = 0 AND title = '' THEN ? ELSE title END
                        WHERE id = ?""",
                     (now, strip_markers(answer).strip()[:PREVIEW_LENGTH], question.strip()[:TITLE_LENGTH],
                      conversation_id))


def imported(key: str) -> bool:
    with _session() as conn:
        return conn.execute("SELECT 1 FROM conversation_marks WHERE key = ?", (key,)).fetchone() is not None


def import_rows(rows: list[dict], key: str) -> int:
    """Conversations listed somewhere before this table existed; ones already here are left as they are."""
    with _session() as conn:
        before = conn.total_changes
        conn.executemany("""INSERT OR IGNORE INTO conversations
            (id, project_id, title, titled, preview, archived, created_at, updated_at)
            VALUES (:id, :project_id, :title, :titled, :preview, :archived, :created_at, :updated_at)""",
                         [{**r, "project_id": _project(r.get("scope")),
                           "title": (r.get("title") or "").strip()[:TITLE_LENGTH],
                           "preview": strip_markers(r.get("preview") or "").strip()[:PREVIEW_LENGTH]}
                          for r in rows])
        added = conn.total_changes - before
        conn.execute("INSERT OR IGNORE INTO conversation_marks (key) VALUES (?)", (key,))
    return added
