"""Workspace presentation settings alongside the memory system's project identities."""
from datetime import datetime, timezone

from .memory.store import session
from .memory.types import MemoryError


def directory() -> list[dict]:
    with session() as conn:
        rows = conn.execute("""
            SELECT p.id, p.name, p.isolated, COALESCE(s.starred, 0) AS starred,
                   COALESCE(s.description, '') AS description, COALESCE(s.instructions, '') AS instructions,
                   MAX(COALESCE(s.updated_at, ''), COALESCE((SELECT MAX(created_at) FROM events
                       WHERE entity = 'projects' AND entity_id = p.id), '')) AS updated_at
            FROM projects p LEFT JOIN project_settings s ON s.project_id = p.id
            WHERE p.id NOT IN (SELECT id FROM removed_projects)
        """)
        return [{**dict(row), "isolated": bool(row["isolated"]), "starred": bool(row["starred"])} for row in rows]


def instructions(project_id: str) -> str:
    with session() as conn:
        row = conn.execute("SELECT instructions FROM project_settings WHERE project_id = ? "
                           "AND project_id NOT IN (SELECT id FROM removed_projects)", (project_id,)).fetchone()
        return row["instructions"].strip() if row else ""


def configure(project_id: str, fields: dict) -> dict:
    valid = {"starred": bool, "description": str}
    if not isinstance(fields, dict) or not fields or any(key not in valid or not isinstance(value, valid[key]) for key, value in fields.items()):
        raise MemoryError("Invalid project settings.")
    with session() as conn:
        if not conn.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone():
            raise MemoryError("No such project.")
        conn.execute("INSERT OR IGNORE INTO project_settings(project_id) VALUES (?)", (project_id,))
        conn.execute("""
            UPDATE project_settings SET starred = COALESCE(?, starred), description = COALESCE(?, description),
                   updated_at = ? WHERE project_id = ?
        """, (fields.get("starred"), fields.get("description"), datetime.now(timezone.utc).isoformat(), project_id))
    return {}


def remove_local(project_id: str) -> dict:
    with session() as conn:
        if not conn.execute("SELECT 1 FROM projects WHERE id = ?", (project_id,)).fetchone():
            raise MemoryError("No such project.")
        conn.execute("INSERT OR IGNORE INTO removed_projects VALUES (?)", (project_id,))
        conn.execute("DELETE FROM project_folders WHERE project_id = ?", (project_id,))
    from contextlens.project_files.watch import watcher

    watcher.restart()  # its folders are no longer watched
    return {}
