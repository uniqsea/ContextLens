"""Watch the linked folders and queue what changes in them for indexing (index.py).

One thread watches every linked folder (watchfiles: FSEvents on macOS, inotify on Linux) and is
restarted whenever the set of folders changes. Events are batched by watchfiles, so saving a file
several times in a row is indexed once.
"""
from __future__ import annotations

import logging
import os
from threading import Event, Lock, Thread

import watchfiles

from contextlens.memory.store import session

from . import index

log = logging.getLogger(__name__)


class Watcher:
    def __init__(self):
        self._lock = Lock()
        self._stop: Event | None = None
        self._thread: Thread | None = None
        self.running = False  # off until the backend starts it; tests never do

    def start(self) -> None:
        self.running = True
        self.restart()

    def stop(self) -> None:
        self.running = False
        with self._lock:
            self._halt()

    def restart(self) -> None:
        """Watch the folders linked now. Called when one is linked or unlinked."""
        if not self.running:
            return
        with self._lock:
            self._halt()
            with session() as conn:
                roots = sorted({r["path"] for r in conn.execute("SELECT path FROM project_folders")})
            roots = [r for r in roots if os.path.isdir(r)]
            if not roots:
                return
            self._stop = Event()
            self._thread = Thread(target=self._run, args=(roots, self._stop), daemon=True, name="contextlens-watch")
            self._thread.start()

    def _halt(self) -> None:
        if self._stop is not None:
            self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        self._stop = self._thread = None

    @staticmethod
    def _run(roots: list[str], stop: Event) -> None:
        try:
            for changes in watchfiles.watch(*roots, stop_event=stop, ignore_permission_denied=True,
                                            raise_interrupt=False):
                index.on_change({path for _, path in changes})
        except Exception:  # a folder removed while watched, or the OS refusing: indexing catches up on restart
            log.exception("watching linked folders stopped")


watcher = Watcher()
