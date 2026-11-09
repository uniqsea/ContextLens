"""Keep the index of linked folders current, and find a project's files in it.

Every file is only registered: its path and fingerprint (`file_stamp`), nothing read, so it can be listed
and found by its name. PDF and Word files are also split into passages, by LlamaIndex's sentence
splitter, page by page for a PDF so each passage knows its page, and then get vectors from the local
embedding model (retrieval.py). Their passages are found by words and by meaning.

That work happens in the background, at three moments: when a folder is linked (folders.py), when
something in a linked folder changes (watch.py), and when the backend starts, to catch up with what
changed while it was off. Searching only reads what is there. Small files go first, so most are
searchable soon after a folder is linked.

A file chosen for a turn goes into the request whole, read when the request is built (`content`); one
too large for that is left to the agent's file tools.
"""
from __future__ import annotations

import hashlib
import logging
import os
import stat
from collections import OrderedDict
from contextlib import ExitStack
from pathlib import Path, PurePosixPath
from threading import Condition, Lock, Thread

from contextlens.memory.store import session
from contextlens.passages import split, terms

from . import retrieval
from .documents import BINARY_SUFFIXES, DOCUMENT_SUFFIXES, IMAGE_SUFFIXES, SKIP_DIRS, extract, files
from .folders import file_stamp, open_root

log = logging.getLogger(__name__)
INJECT_TOKENS = 20_000  # a chosen file larger than this is read by the agent instead
# Registered (the agent sees them listed) but never offered as context: by their names, nothing to read.
_UNOFFERED = BINARY_SUFFIXES - IMAGE_SUFFIXES
_BATCH = 256


def passages(name: str, text: str) -> list[tuple[int | None, str]]:
    """(page, passage) in reading order; pages count from 1 and only a PDF has them (pdftotext ends
    each page with a form feed)."""
    paged = name.lower().endswith(".pdf")
    out = []
    for number, page in enumerate(text.split("\f") if paged else [text], 1):
        if page.strip():
            out.extend((number if paged else None, piece) for piece in split(page))
    return out


def _id(scope, root_id, path):
    return "doc-" + hashlib.sha256(f"{scope}/{root_id}/{path}".encode()).hexdigest()[:20]


def _split_by_content(path: str) -> bool:
    return PurePosixPath(path).suffix.lower() in DOCUMENT_SUFFIXES


def _visible(rel: str) -> bool:
    """Whether a path inside a folder is one `files` would list (no hidden parts, no skipped folders)."""
    parts = PurePosixPath(rel).parts
    return bool(parts) and ".." not in parts and not any(p.startswith(".") for p in parts) \
        and not any(p in SKIP_DIRS for p in parts[:-1])


# ---------- registering ----------

def _register(conn, folder, changed) -> None:
    """New or changed files, as (path, stamp): registered under their name, any old passages gone."""
    for path, stamp in changed:
        doc = conn.execute("""INSERT INTO project_documents(folder_id, path, stamp, source_id) VALUES (?, ?, ?, ?)
            ON CONFLICT(folder_id, path) DO UPDATE SET stamp = excluded.stamp RETURNING id""",
                           (folder["id"], path, stamp, _id(folder["project_id"], folder["path"], path))).fetchone()[0]
        conn.execute("DELETE FROM project_passage_vectors WHERE passage_id IN "
                     "(SELECT rowid FROM project_passages WHERE document_id = ?)", (doc,))
        conn.execute("DELETE FROM project_passages WHERE document_id = ?", (doc,))
        # Found by name until (and, for any other file, instead of) its content is indexed.
        conn.execute("INSERT INTO project_passages(document_id, page, name, terms, excerpt) VALUES (?, NULL, ?, '', '')",
                     (doc, terms(path)))


def _write(folder, changed, gone) -> bool:
    with session() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if not conn.execute("SELECT 1 FROM project_folders WHERE id = ?", (folder["id"],)).fetchone():
            return False  # unlinked meanwhile
        _register(conn, folder, changed)
        conn.executemany("DELETE FROM project_documents WHERE folder_id = ? AND path = ?",
                         ((folder["id"], path) for path in gone))
    return True


def _known(folder, prefix: str) -> dict[str, str]:
    with session() as conn:
        rows = conn.execute("SELECT path, stamp FROM project_documents WHERE folder_id = ?"
                            + (" AND (path = ? OR path LIKE ? ESCAPE '\\')" if prefix else ""),
                            (folder["id"], *((prefix, _like(prefix) + "/%") if prefix else ()))).fetchall()
    return {r["path"]: r["stamp"] for r in rows}


def _like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _open_dir(root_fd: int, parts, stack: ExitStack) -> int:
    parent = root_fd
    for part in parts:
        parent = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        stack.callback(os.close, parent)
    return parent


def _reconcile(folder, root_fd: int, prefix: str = "") -> bool:
    """Bring the registered files under `prefix` (the whole folder when empty) in line with the disk,
    by their fingerprints alone."""
    known = _known(folder, prefix)
    changed = []
    parts = PurePosixPath(prefix).parts if prefix else ()
    with ExitStack() as stack:
        try:
            parent = _open_dir(root_fd, parts[:-1], stack)
            info = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False) if parts else os.fstat(root_fd)
        except OSError:
            info = None  # gone, or no longer reachable without a symlink
        if info is not None and stat.S_ISREG(info.st_mode):
            stamp = file_stamp(info)
            if known.pop(prefix, None) != stamp:
                changed.append((prefix, stamp))
        elif info is not None and stat.S_ISDIR(info.st_mode) and not (parts and parts[-1] in SKIP_DIRS):
            directory = _open_dir(parent, parts[-1:], stack) if parts else root_fd
            for path, _, entry in files(directory):
                path = f"{prefix}/{path}" if prefix else path
                stamp = file_stamp(entry)
                if known.pop(path, None) != stamp:
                    changed.append((path, stamp))
                if len(changed) >= _BATCH:
                    if not _write(folder, changed, ()):
                        return False
                    changed = []
    return _write(folder, changed, known)


# ---------- splitting PDF and Word files ----------

def _size(stamp: str) -> int:
    try:
        return int(stamp.split(":")[2])
    except (IndexError, ValueError):
        return 0


def _split_pending(folder, root_fd: int) -> None:
    """Split the folder's PDF and Word files whose passages are not of their current version, smallest first."""
    with session() as conn:
        rows = conn.execute("""SELECT id, path, stamp FROM project_documents
            WHERE folder_id = ? AND passages_stamp IS NOT stamp""", (folder["id"],)).fetchall()
    for row in sorted((r for r in rows if _split_by_content(r["path"])), key=lambda r: _size(r["stamp"])):
        parts = PurePosixPath(row["path"]).parts
        try:
            with ExitStack() as stack:
                parent = _open_dir(root_fd, parts[:-1], stack)
                if file_stamp(os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)) != row["stamp"]:
                    continue  # changed since it was registered: the change is on its way
                text = extract(parts[-1], parent, _size(row["stamp"]))
                if file_stamp(os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)) != row["stamp"]:
                    continue
        except OSError:
            continue
        pieces = passages(row["path"], text)
        name = terms(row["path"])
        with session() as conn:
            conn.execute("BEGIN IMMEDIATE")
            if not conn.execute("SELECT 1 FROM project_documents WHERE id = ? AND stamp = ?",
                                (row["id"], row["stamp"])).fetchone():
                continue
            if pieces:
                conn.execute("DELETE FROM project_passages WHERE document_id = ?", (row["id"],))
                conn.executemany("INSERT INTO project_passages(document_id, page, name, terms, excerpt) VALUES (?, ?, ?, ?, ?)",
                                 ((row["id"], page, name, terms(piece), piece) for page, piece in pieces))
            conn.execute("UPDATE project_documents SET passages_stamp = stamp WHERE id = ?", (row["id"],))


# ---------- the background queue ----------

class Queue:
    """Folders (or paths in them) waiting to be brought up to date, worked through by one thread.

    With `background` off (tests), each request is carried out before `add` returns.
    """

    def __init__(self):
        self.background = True
        self._waiting: dict[str, set[str] | None] = {}  # folder id -> paths, None for the whole folder
        self._ready = Condition()
        self._work = Lock()
        self._thread: Thread | None = None

    def add(self, folder_id: str, paths=None) -> None:
        with self._ready:
            if paths is None or self._waiting.get(folder_id, ()) is None:
                self._waiting[folder_id] = None
            else:
                self._waiting.setdefault(folder_id, set()).update(paths)
            if self.background and (self._thread is None or not self._thread.is_alive()):
                self._thread = Thread(target=self._run, daemon=True, name="contextlens-index")
                self._thread.start()
            self._ready.notify()
        if not self.background:
            self.drain()

    def _run(self) -> None:
        while True:
            with self._ready:
                while not self._waiting:
                    self._ready.wait()
            self.drain()

    def drain(self) -> None:
        """Carry out every waiting request."""
        while True:
            with self._ready:
                if not self._waiting:
                    return
                folder_id, paths = self._waiting.popitem()
            with self._work:
                try:
                    _update(folder_id, paths)
                except Exception:  # one bad folder must not stop the queue
                    log.exception("folder %s not indexed", folder_id)


queue = Queue()


def _update(folder_id: str, paths) -> None:
    with session() as conn:
        folder = conn.execute("SELECT * FROM project_folders WHERE id = ?", (folder_id,)).fetchone()
    if folder is None:
        return
    try:
        with open_root(folder) as fd:
            for prefix in sorted(paths) if paths is not None else [""]:
                if not _reconcile(folder, fd, prefix):
                    return
            _split_pending(folder, fd)
    except OSError:
        return  # unreachable or replaced: searched as absent until it is back
    retrieval.vectors.soon()


def index_folders(folder_ids) -> None:
    for folder_id in folder_ids:
        queue.add(folder_id)


def catch_up() -> None:
    """At startup: every linked folder, for what changed while the backend was off."""
    with session() as conn:
        index_folders([r["id"] for r in conn.execute("SELECT id FROM project_folders ORDER BY path")])


def on_change(paths) -> None:
    """Absolute paths reported changed (created, modified or deleted): queue them for the folders they are in."""
    with session() as conn:
        folders = conn.execute("SELECT id, path FROM project_folders").fetchall()
    for folder in folders:
        if folder["path"] in paths:
            queue.add(folder["id"])  # the folder itself: look through all of it
            continue
        root = folder["path"].rstrip("/") + "/"
        inside = {os.path.relpath(p, folder["path"]) for p in paths if p.startswith(root)}
        inside = {p for p in inside if _visible(p)}
        if inside:
            queue.add(folder["id"], inside)


# ---------- reading the index ----------

def readable_folders(scope: str) -> list:
    """The project's linked folders that are still there, never one replaced after it was linked."""
    with session() as conn:
        roots = list(conn.execute("SELECT * FROM project_folders WHERE project_id = ? ORDER BY path", (scope,)))
    readable = []
    for root in roots:
        try:
            with open_root(root):
                readable.append(root)
        except OSError:
            continue
    return readable


def mount_names(folders) -> dict[str, str]:
    """Each folder's name under /projects/, made unique when two share one."""
    names: dict[str, str] = {}
    for row in folders:
        base = Path(row["path"]).name or "folder"
        name, n = base, 1
        while name in names.values():
            n += 1
            name = f"{base}-{n}"
        names[row["id"]] = name
    return names


def _offered(path: str) -> bool:
    return PurePosixPath(path).suffix.lower() not in _UNOFFERED


def _dependency(row):
    return {key: row[key] for key in ("folder", "path", "stamp")}


def search(scope: str, question: str, *, inventory: bool = False) -> list[dict]:
    """The best passage of each file that matches the question, best file first; in field mode every
    registered file too, unranked ones after. Cards carry no content: `content` reads it when chosen."""
    if not (question.strip() or inventory):
        return []
    active = [r["id"] for r in readable_folders(scope)]
    if not active:
        return []
    within = retrieval.Within(scope, tuple(active))
    # A nested folder may also be linked on its own. Keep the same source id when a query matches
    # the two bindings differently, so a chosen file keeps its place in the input.
    catalog = {}
    if inventory:
        with session() as conn:
            rows = conn.execute(f"""SELECT f.id AS folder, f.path AS root, d.path, d.stamp
                FROM project_documents d JOIN project_folders f ON d.folder_id = f.id
                WHERE {within.where} ORDER BY f.path, d.path""", within.params)
            for row in rows:
                if _offered(row["path"]):
                    catalog.setdefault(os.path.join(row["root"], row["path"]), dict(row))
    matches = retrieval.find(within, question, limit=None if inventory else 24)
    hits = []
    seen = set()

    def card(row, passage, rank=None):
        label = f'{Path(row["root"]).name}/{row["path"]}'
        page = passage.get("page")
        return {"id": _id(scope, row["root"], row["path"]), "title": label, "content": "",
                "source_label": f"{label} · p. {page}" if page else label, "rank": rank, "page": page,
                "excerpt": passage.get("excerpt") or "", "files": [_dependency(row)]}

    for passage in matches:
        absolute = os.path.join(passage["root"], passage["path"])
        if absolute in seen or not _offered(passage["path"]):
            continue
        seen.add(absolute)
        hits.append(card(catalog.get(absolute, passage), passage, len(hits) + 1))
        if not inventory and len(hits) == 4:
            break
    hits.extend(card(row, {}) for path, row in catalog.items() if path not in seen)
    return hits


_TEXTS: OrderedDict[tuple, str | None] = OrderedDict()
_TEXTS_LOCK = Lock()


def read_text(folder, path: str) -> str | None:
    """A registered file's readable text as it is now (PDF and Word as extracted text), or None for one
    with none: binary, too large, unreadable, or reached only through a symlink."""
    parts = PurePosixPath(path).parts
    if not _visible(path):
        return None
    try:
        with open_root(folder) as root, ExitStack() as stack:
            parent = _open_dir(root, parts[:-1], stack)
            info = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode):
                return None
            key = (folder["id"], path, file_stamp(info))
            with _TEXTS_LOCK:
                if key in _TEXTS:
                    _TEXTS.move_to_end(key)
                    return _TEXTS[key]
            text = extract(parts[-1], parent, info.st_size) or None
    except OSError:
        return None
    with _TEXTS_LOCK:  # the preview asks again on every keystroke; extracting a PDF can take seconds
        _TEXTS[key] = text
        while len(_TEXTS) > 16:
            _TEXTS.popitem(last=False)
    return text


def content(scope: str, card: dict, count_tokens) -> str:
    """What a chosen file puts in the request: all of it, or, when too large, where the agent can read it."""
    dep = card["files"][0]
    folders = readable_folders(scope)
    folder = next((f for f in folders if f["id"] == dep["folder"]), None)
    text = read_text(folder, dep["path"]) if folder is not None else None
    if text is None:
        return "(No readable text.)"
    tokens = count_tokens(text)
    if tokens <= INJECT_TOKENS:
        return text
    where = f"/projects/{mount_names(folders)[folder['id']]}/{dep['path']}"
    note = (f"Too large to include in full (about {tokens} tokens). Read the parts you need with grep and "
            f"read_file at {where}.")
    return f"{note}\n\nThe passage that matched:\n{card['excerpt']}" if card.get("excerpt") else note
