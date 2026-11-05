"""Project-owned folder references. File bytes stay on the local machine until selected as context."""
import json
import os
import subprocess
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path

from contextlens.memory.store import session
from contextlens.memory.types import MemoryError

from .documents import SKIP_DIRS, files


def _require_project(conn, project_id):
    if not conn.execute("SELECT 1 FROM projects WHERE id = ? AND id NOT IN (SELECT id FROM removed_projects)", (project_id,)).fetchone():
        raise MemoryError("No such project.")


def folders(project_id: str) -> list[dict]:
    with session() as conn:
        _require_project(conn, project_id)
        return [dict(row) for row in conn.execute(
            "SELECT id, path FROM project_folders WHERE project_id = ? ORDER BY path", (project_id,))]


def _validated_roots(paths: list[str]) -> list[tuple]:
    if not isinstance(paths, list) or not all(isinstance(p, str) and p.strip() for p in paths):
        raise MemoryError("Choose one or more directories.")
    roots = []
    for value in paths:
        try:
            path = Path(value).expanduser()
            if not path.is_absolute():
                raise ValueError
            path = path.resolve(strict=True)
            if not path.is_dir() or not os.access(path, os.R_OK | os.X_OK):
                raise ValueError
            stat = path.stat()
        except (OSError, RuntimeError, ValueError):
            raise MemoryError("Choose an existing, readable absolute directory.") from None
        roots.append((str(path), stat.st_dev, str(stat.st_ino)))
    return roots


def _bind(conn, project_id, roots):
    conn.executemany("INSERT INTO project_folders(id, project_id, path, device, inode) VALUES (?, ?, ?, ?, ?) "
                     "ON CONFLICT(project_id, path) DO UPDATE SET device=excluded.device, inode=excluded.inode",
                     [(uuid.uuid4().hex, project_id, *root) for root in roots])


def create_with_folders(name, source, paths):
    from contextlens.memory.operations import create_project

    roots = _validated_roots(paths)
    with session() as conn:
        project = create_project(name, source, conn=conn)
        _bind(conn, project.id, roots)
    return project


def edit_project(project_id, source, body):
    from dataclasses import replace
    from contextlens.memory import Project, commit, get

    name, paths = body.get("name"), body.get("paths")
    if not isinstance(name, str) or not name.strip() or not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
        raise MemoryError("Invalid project.")
    with session() as conn:
        conn.execute("BEGIN IMMEDIATE")
        _require_project(conn, project_id)
        project = get(Project, project_id, conn)
        current = {r["path"] for r in conn.execute("SELECT path FROM project_folders WHERE project_id = ?", (project_id,))}
        if body.get("previous") != {"name": project.name, "paths": sorted(current)}:
            raise MemoryError("Project changed. Reopen the editor.")
        roots = _validated_roots([path for path in paths if path not in current])
        keep = set(paths) | {root[0] for root in roots}
        _bind(conn, project_id, roots)
        conn.executemany("DELETE FROM project_folders WHERE project_id = ? AND path = ?",
                         [(project_id, path) for path in current - keep])
        commit(source, "revised", replace(project, name=name.strip()), conn=conn)
    return {}


def attach(project_id: str, paths: list[str]) -> list[dict]:
    roots = _validated_roots(paths)
    with session() as conn:
        _require_project(conn, project_id)
        _bind(conn, project_id, roots)
    return folders(project_id)


def detach(project_id: str, folder_id: str) -> list[dict]:
    with session() as conn:
        conn.execute("DELETE FROM project_folders WHERE project_id = ? AND id = ?", (project_id, folder_id))
    return folders(project_id)


@contextmanager
def open_root(row):
    """Follow the selected directory identity, never a symlink substituted after selection."""
    fd = os.open(row["path"], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        st = os.fstat(fd)
        if (st.st_dev, str(st.st_ino)) != (row["device"], row["inode"]):
            raise OSError("Directory replaced")
        yield fd
    finally:
        os.close(fd)


_PICK = """
const app = Application.currentApplication();
app.includeStandardAdditions = true;
try {
  const selected = app.chooseFolder({withPrompt: "ContextLens", multipleSelectionsAllowed: true});
  JSON.stringify(selected.map(folder => folder.toString()));
} catch (error) {
  if (error.errorNumber !== -128) throw error;
  "[]";
}
"""


def pick(project_id: str) -> list[dict]:
    folders(project_id)
    return attach(project_id, choose_paths())


def choose_paths() -> list[str]:
    if sys.platform != "darwin":
        raise MemoryError("The system folder picker requires macOS.")
    try:
        result = subprocess.run(["/usr/bin/osascript", "-l", "JavaScript", "-e", _PICK],
                                capture_output=True, text=True, check=True, timeout=300)
        paths = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        raise MemoryError("Could not open the folder picker.") from None
    return paths


def list_files(project_id: str, folder_id: str, directory: str | None = None, query: str = "") -> list:
    with session() as conn:
        row = conn.execute("SELECT * FROM project_folders WHERE project_id = ? AND id = ?",
                           (project_id, folder_id)).fetchone()
    if row is None:
        raise MemoryError("No such project folder.")
    try:
        with open_root(row) as fd:
            if query:
                return [{"name": Path(path).name, "path": path, "directory": False}
                        for path, _, _ in files(fd) if query.casefold() in path.casefold()]
            if directory is None:
                return [path for path, _, _ in files(fd)]
            current = os.dup(fd)
            try:
                for part in directory.split("/") if directory else ():
                    if not part or part.startswith(".") or part in SKIP_DIRS or "\x00" in part:
                        raise MemoryError("Invalid folder.")
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
                    os.close(current)
                    current = child
                entries = []
                with os.scandir(current) as listing:
                    for entry in listing:
                        if entry.name.startswith("."):
                            continue
                        subdir = entry.is_dir(follow_symlinks=False)
                        if subdir and entry.name in SKIP_DIRS:
                            continue
                        if subdir or entry.is_file(follow_symlinks=False):
                            entries.append({"name": entry.name, "path": os.path.join(directory, entry.name),
                                            "directory": subdir})
                return sorted(entries, key=lambda item: (not item["directory"], item["name"].casefold()))
            finally:
                os.close(current)
    except OSError:
        raise MemoryError("Folder unavailable.") from None


def file_stamp(info):
    return f"{info.st_dev}:{info.st_ino}:{info.st_size}:{info.st_mtime_ns}:{info.st_ctime_ns}"


def unchanged(scope: str, dependencies: list[dict]) -> bool:
    """A historical answer can re-enter context only while its cited files are still available."""
    if not dependencies:
        return True
    with session() as conn:
        roots = {r["id"]: r for r in conn.execute("SELECT * FROM project_folders WHERE project_id = ?", (scope,))}
    for dep in dependencies:
        root = roots.get(dep["folder"])
        parts = Path(dep["path"]).parts
        if root is None or not parts or Path(dep["path"]).is_absolute() or ".." in parts:
            return False
        try:
            with open_root(root) as root_fd:
                parent = os.dup(root_fd)
                try:
                    for part in parts[:-1]:
                        child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                        os.close(parent)
                        parent = child
                    info = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
                    if file_stamp(info) != dep["stamp"]:
                        return False
                finally:
                    os.close(parent)
        except OSError:
            return False
    return True
