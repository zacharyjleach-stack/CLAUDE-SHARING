"""Git operations for syncing shared CLAUDE.md files."""

import logging
import os
import shutil
from pathlib import Path
from typing import Optional

import git
from git import Repo, GitCommandError, InvalidGitRepositoryError

from . import config as cfg_mod

log = logging.getLogger(__name__)


def _actor(cfg: cfg_mod.Config) -> git.Actor:
    return git.Actor(cfg.author_name, cfg.author_email)


def clone_or_open(cfg: cfg_mod.Config) -> Repo:
    """Return the local shared repo, cloning it if it doesn't exist yet."""
    local = Path(cfg.shared_repo_local)
    if local.exists() and (local / ".git").exists():
        repo = Repo(local)
        # Ensure remote URL matches config
        if "origin" in [r.name for r in repo.remotes]:
            if repo.remotes.origin.url != cfg.shared_repo_url:
                repo.remotes.origin.set_url(cfg.shared_repo_url)
        return repo

    log.info("Cloning shared repo %s → %s", cfg.shared_repo_url, local)
    local.mkdir(parents=True, exist_ok=True)
    repo = Repo.clone_from(cfg.shared_repo_url, local, branch=cfg.branch)
    return repo


def pull(repo: Repo, cfg: cfg_mod.Config) -> list[str]:
    """
    Pull latest from remote.
    Returns list of CLAUDE.md files that were updated.
    """
    try:
        repo.remotes.origin.fetch()
        remote_ref = f"origin/{cfg.branch}"

        local_commit = repo.head.commit.hexsha
        try:
            remote_commit = repo.commit(remote_ref).hexsha
        except Exception:
            return []

        if local_commit == remote_commit:
            return []

        # Prefer rebase so concurrent team pushes don't cause divergence
        try:
            repo.git.rebase(remote_ref)
        except GitCommandError:
            repo.git.rebase("--abort")
            repo.git.merge(remote_ref, "--ff-only")
        log.info("Pulled updates from remote")

        changed = [
            item.a_path
            for item in repo.head.commit.diff(f"{local_commit}")
            if item.a_path.endswith("CLAUDE.md")
        ]
        return changed

    except GitCommandError as e:
        log.warning("Pull failed: %s", e)
        return []


def push(repo: Repo, cfg: cfg_mod.Config) -> bool:
    """Push local commits to remote, auto-rebasing on rejection. Returns True on success."""
    for attempt in range(3):
        try:
            repo.remotes.origin.push(refspec=f"{cfg.branch}:{cfg.branch}")
            log.info("Pushed to remote")
            return True
        except GitCommandError as e:
            if "rejected" in str(e).lower() or "non-fast-forward" in str(e).lower():
                log.info("Push rejected, pulling and retrying (attempt %d/3)…", attempt + 1)
                try:
                    repo.remotes.origin.fetch()
                    repo.git.rebase(f"origin/{cfg.branch}")
                except GitCommandError:
                    try:
                        repo.git.rebase("--abort")
                    except GitCommandError:
                        pass
                    log.warning("Rebase failed, giving up push")
                    return False
            else:
                log.warning("Push failed: %s", e)
                return False
    log.warning("Push failed after 3 attempts")
    return False


def project_key(project_dir: Path) -> str:
    """
    Derive a stable directory name for this project inside the shared repo.
    Uses the last two path components, e.g. 'acme/my-api'.
    """
    parts = project_dir.resolve().parts
    return "__".join(parts[-2:]) if len(parts) >= 2 else parts[-1]


def update_shared_claude_md(
    repo: Repo,
    cfg: cfg_mod.Config,
    project_dir: Path,
    content: str,
) -> bool:
    """
    Write the given CLAUDE.md content into the shared repo and commit it.
    Returns True if a new commit was made.
    """
    key = project_key(project_dir)
    dest = Path(repo.working_dir) / key / "CLAUDE.md"
    dest.parent.mkdir(parents=True, exist_ok=True)

    # Write a header so readers know which local path this maps to
    header = f"<!-- shared from: {project_dir} -->\n"
    full_content = header + content

    if dest.exists() and dest.read_text() == full_content:
        return False  # Nothing changed

    dest.write_text(full_content)
    repo.index.add([str(dest.relative_to(repo.working_dir))])

    actor = _actor(cfg)
    repo.index.commit(
        f"sync: update {key}/CLAUDE.md",
        author=actor,
        committer=actor,
    )
    log.info("Committed update for %s", key)
    return True


def copy_shared_to_local(
    repo: Repo,
    project_dir: Path,
    dest_path: Optional[Path] = None,
) -> bool:
    """
    Copy the shared CLAUDE.md for this project into the local project directory
    (or dest_path if provided). Strips the header comment.
    Returns True if the file was written/updated.
    """
    key = project_key(project_dir)
    src = Path(repo.working_dir) / key / "CLAUDE.md"
    if not src.exists():
        return False

    content = src.read_text()
    # Strip the header we added
    lines = content.splitlines(keepends=True)
    if lines and lines[0].startswith("<!-- shared from:"):
        content = "".join(lines[1:])

    target = dest_path or (project_dir / "CLAUDE.md")

    if target.exists() and target.read_text() == content:
        return False

    target.write_text(content)
    log.info("Updated local CLAUDE.md at %s", target)
    return True


def init_shared_repo_if_empty(repo: Repo, cfg: cfg_mod.Config) -> None:
    """If the shared repo has no commits, create an initial one."""
    try:
        repo.head.commit
    except ValueError:
        readme = Path(repo.working_dir) / "README.md"
        readme.write_text(
            "# Claude Sharing\n\nThis repo is managed by `claude-share`.\n"
            "Do not edit manually.\n"
        )
        repo.index.add(["README.md"])
        actor = _actor(cfg)
        repo.index.commit("init: initial commit", author=actor, committer=actor)
        log.info("Initialized shared repo with first commit")
