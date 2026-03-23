"""Configuration management for claude-sharing."""

import json
import os
import sys
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional


CONFIG_DIR = Path.home() / ".claude-sharing"
CONFIG_FILE = CONFIG_DIR / "config.json"


@dataclass
class Config:
    # Required: URL of the shared git repo all team members push/pull from
    shared_repo_url: str = ""
    # Local clone of the shared repo (auto-set if empty)
    shared_repo_local: str = ""
    # Directories to watch for CLAUDE.md changes
    watch_dirs: list[str] = field(default_factory=list)
    # How often to sync with remote (seconds)
    sync_interval: int = 30
    # Git author name/email for commits
    author_name: str = ""
    author_email: str = ""
    # Branch to use in shared repo — defaults to an orphan branch so
    # claude-sharing commits don't appear on the team's code branches
    branch: str = "claude-context"

    def __post_init__(self):
        if not self.shared_repo_local:
            self.shared_repo_local = str(CONFIG_DIR / "shared-repo")
        if not self.author_name:
            self.author_name = os.environ.get("GIT_AUTHOR_NAME") or os.environ.get("USER") or "claude-sharing"
        if not self.author_email:
            self.author_email = os.environ.get("GIT_AUTHOR_EMAIL") or f"{self.author_name}@claude-sharing.local"


def load() -> Config:
    if not CONFIG_FILE.exists():
        return Config()
    with open(CONFIG_FILE) as f:
        data = json.load(f)
    return Config(**{k: v for k, v in data.items() if k in Config.__dataclass_fields__})


def save(cfg: Config) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(asdict(cfg), f, indent=2)


def require(cfg: Config) -> None:
    """Abort with a helpful message if config is incomplete."""
    if not cfg.shared_repo_url:
        print("Error: shared_repo_url is not set.", file=sys.stderr)
        print(f"Run: claude-share config --repo <git-url>", file=sys.stderr)
        sys.exit(1)
    if not cfg.watch_dirs:
        print("Error: no watch_dirs configured.", file=sys.stderr)
        print("Run: claude-share watch --add <path>", file=sys.stderr)
        sys.exit(1)
