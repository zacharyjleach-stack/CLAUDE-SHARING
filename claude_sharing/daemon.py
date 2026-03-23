"""
Background daemon: watches local CLAUDE.md files and syncs them via a shared git repo.

Loop:
  1. On local CLAUDE.md change  → commit to shared repo → push
  2. Every sync_interval seconds → pull from shared repo → update local CLAUDE.md files
"""

import logging
import signal
import sys
import threading
import time
from pathlib import Path
from typing import Optional

from . import config as cfg_mod
from . import git_sync
from .watcher import Watcher

log = logging.getLogger(__name__)


class Daemon:
    def __init__(self, cfg: cfg_mod.Config):
        self.cfg = cfg
        self._repo: Optional[object] = None
        self._lock = threading.Lock()  # Serialize git operations
        self._stop_event = threading.Event()
        self._watcher = Watcher(self._on_local_change)
        # Debounce: track pending uploads per path
        self._pending: dict[str, threading.Timer] = {}

    # ------------------------------------------------------------------
    # Startup
    # ------------------------------------------------------------------

    def start(self) -> None:
        log.info("Starting claude-sharing daemon")

        self._repo = git_sync.clone_or_open(self.cfg)
        git_sync.init_shared_repo_if_empty(self._repo, self.cfg)

        # Do an initial pull before we start watching
        self._pull_and_update_locals()

        for d in self.cfg.watch_dirs:
            p = Path(d)
            if p.exists():
                self._watcher.add(p)
            else:
                log.warning("Watch dir does not exist, skipping: %s", d)

        self._watcher.start()

        # Periodic sync thread
        sync_thread = threading.Thread(target=self._sync_loop, daemon=True)
        sync_thread.start()

        log.info(
            "Daemon running. Watching %d director(ies). Sync interval: %ds",
            len(self.cfg.watch_dirs),
            self.cfg.sync_interval,
        )

        # Handle SIGTERM/SIGINT for clean shutdown
        signal.signal(signal.SIGTERM, self._handle_signal)
        signal.signal(signal.SIGINT, self._handle_signal)

        self._stop_event.wait()
        self._shutdown()

    # ------------------------------------------------------------------
    # Local change → upload
    # ------------------------------------------------------------------

    def _on_local_change(self, claude_md_path: Path) -> None:
        """Called by the file watcher when a CLAUDE.md is written."""
        key = str(claude_md_path)
        # Cancel any existing debounce timer for this file
        if key in self._pending:
            self._pending[key].cancel()
        # Wait 2s in case the editor is still writing
        t = threading.Timer(2.0, self._upload, args=(claude_md_path,))
        self._pending[key] = t
        t.start()

    def _upload(self, claude_md_path: Path) -> None:
        project_dir = claude_md_path.parent
        try:
            content = claude_md_path.read_text()
        except OSError as e:
            log.warning("Could not read %s: %s", claude_md_path, e)
            return

        with self._lock:
            committed = git_sync.update_shared_claude_md(
                self._repo, self.cfg, project_dir, content
            )
            if committed:
                git_sync.push(self._repo, self.cfg)
                log.info("Uploaded CLAUDE.md for %s", project_dir)

    # ------------------------------------------------------------------
    # Periodic pull → update locals
    # ------------------------------------------------------------------

    def _sync_loop(self) -> None:
        while not self._stop_event.is_set():
            self._stop_event.wait(timeout=self.cfg.sync_interval)
            if not self._stop_event.is_set():
                self._pull_and_update_locals()

    def _pull_and_update_locals(self) -> None:
        with self._lock:
            changed = git_sync.pull(self._repo, self.cfg)

        if not changed:
            return

        log.info("Remote has %d updated CLAUDE.md file(s)", len(changed))

        for watch_dir in self.cfg.watch_dirs:
            p = Path(watch_dir)
            if not p.exists():
                continue
            key = git_sync.project_key(p)
            # Check if any changed path belongs to this project
            if any(c.startswith(key + "/") or c == key for c in changed):
                updated = git_sync.copy_shared_to_local(self._repo, p)
                if updated:
                    log.info("Updated local CLAUDE.md in %s", p)

        # Also scan for any project in the shared repo that matches a watch dir
        # (handles the case where the mapping isn't 1-to-1)
        self._update_all_locals()

    def _update_all_locals(self) -> None:
        """Ensure every watched directory gets the latest shared CLAUDE.md."""
        for watch_dir in self.cfg.watch_dirs:
            p = Path(watch_dir)
            if p.exists():
                git_sync.copy_shared_to_local(self._repo, p)

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------

    def _handle_signal(self, signum, frame) -> None:
        log.info("Signal %d received, shutting down…", signum)
        self._stop_event.set()

    def _shutdown(self) -> None:
        log.info("Stopping file watcher…")
        self._watcher.stop()
        # Cancel pending debounce timers
        for t in self._pending.values():
            t.cancel()
        log.info("Daemon stopped.")
