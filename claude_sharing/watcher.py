"""File-system watcher: detects local CLAUDE.md changes."""

import logging
import threading
from pathlib import Path
from typing import Callable

from watchdog.events import FileSystemEventHandler, FileSystemEvent
from watchdog.observers import Observer

log = logging.getLogger(__name__)


class _ClaudeMdHandler(FileSystemEventHandler):
    """Fires callback whenever a CLAUDE.md is created or modified."""

    def __init__(self, callback: Callable[[Path], None]):
        super().__init__()
        self._callback = callback

    def _handle(self, event: FileSystemEvent) -> None:
        if not event.is_directory and Path(event.src_path).name == "CLAUDE.md":
            log.debug("Detected change: %s", event.src_path)
            self._callback(Path(event.src_path))

    def on_created(self, event: FileSystemEvent) -> None:
        self._handle(event)

    def on_modified(self, event: FileSystemEvent) -> None:
        self._handle(event)


class Watcher:
    """Watches a set of directories for CLAUDE.md changes."""

    def __init__(self, callback: Callable[[Path], None]):
        self._callback = callback
        self._observer = Observer()
        self._watched: set[str] = set()

    def add(self, directory: str | Path) -> None:
        path = str(Path(directory).resolve())
        if path in self._watched:
            return
        self._observer.schedule(_ClaudeMdHandler(self._callback), path, recursive=True)
        self._watched.add(path)
        log.info("Watching %s", path)

    def start(self) -> None:
        self._observer.start()

    def stop(self) -> None:
        self._observer.stop()
        self._observer.join()
