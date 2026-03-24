"""CLI entry point for claude-sharing."""

import json
import logging
import sys
from pathlib import Path

import click

from . import config as cfg_mod
from . import git_sync
from .daemon import Daemon


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        level=level,
    )


# ---------------------------------------------------------------------------
# Root command
# ---------------------------------------------------------------------------

@click.group()
@click.option("--verbose", "-v", is_flag=True, default=False, help="Debug logging.")
@click.pass_context
def main(ctx: click.Context, verbose: bool) -> None:
    """claude-share — keep CLAUDE.md files in sync across your team."""
    ctx.ensure_object(dict)
    ctx.obj["verbose"] = verbose
    _setup_logging(verbose)


# ---------------------------------------------------------------------------
# setup  (one-liner: configure + install hooks + optional commit)
# ---------------------------------------------------------------------------

@main.command("setup")
@click.option("--repo", required=True, help="Shared git repo URL all team members push/pull from.")
@click.option("--branch", default=None, help="Branch to use (default: main).")
@click.option("--commit", is_flag=True, default=False, help="Git-commit the generated .claude/settings.json.")
@click.option("--dir", "project_dir_opt", default=None, help="Project directory (alternative to positional arg).")
@click.argument("project_dir", default=".", type=click.Path(exists=True))
def cmd_setup(repo, branch, commit, project_dir_opt, project_dir):
    """
    One-liner team setup: configure the shared repo and install session hooks.

    \b
    Example (run once per team member, per project):

        claude-share setup --repo git@github.com:org/shared-context.git --commit

    This will:
      1. Save the shared repo URL (and optional branch) to ~/.claude-sharing/config.json
      2. Install SessionStart / Stop hooks into PROJECT_DIR/.claude/settings.json
      3. Add PROJECT_DIR to the daemon watch list
      4. Optionally commit .claude/settings.json so teammates get the hooks automatically
    """
    import subprocess

    # --dir flag overrides positional arg (used by install.sh)
    if project_dir_opt:
        project_dir = project_dir_opt

    # 1. Save config
    cfg = cfg_mod.load()
    cfg.shared_repo_url = repo
    if branch:
        cfg.branch = branch
    cfg_mod.save(cfg)
    click.echo(f"Configured shared repo: {repo}")

    # 2. Install hooks (reuse the logic already in cmd_install_hooks)
    p = Path(project_dir).resolve()
    settings_path = p / ".claude" / "settings.json"
    settings_path.parent.mkdir(parents=True, exist_ok=True)

    if settings_path.exists():
        with open(settings_path) as f:
            try:
                settings = json.load(f)
            except json.JSONDecodeError:
                settings = {}
    else:
        settings = {}

    hooks = settings.setdefault("hooks", {})
    _upsert_hook(hooks, "SessionStart", "claude-share pull")
    _upsert_hook(hooks, "Stop", f"claude-share push {p}")

    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)

    click.echo(f"Hooks installed in {settings_path}")
    click.echo("  SessionStart → claude-share pull")
    click.echo("  Stop         → claude-share push")

    # 3. Register watch dir
    p_str = str(p)
    if p_str not in cfg.watch_dirs:
        cfg.watch_dirs.append(p_str)
        cfg_mod.save(cfg)
        click.echo(f"Watching {p}")

    # 4. Optional commit
    if commit:
        rel = str(settings_path.relative_to(p))
        result = subprocess.run(
            ["git", "add", rel],
            cwd=str(p),
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            click.echo(f"git add failed: {result.stderr.strip()}", err=True)
        else:
            result = subprocess.run(
                ["git", "commit", "-m", "chore: add claude-sharing session hooks"],
                cwd=str(p),
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                click.echo("Committed .claude/settings.json")
            else:
                click.echo(f"git commit failed: {result.stderr.strip()}", err=True)

    click.echo("\nDone! Team members can now run the same command to join.")


# ---------------------------------------------------------------------------
# config
# ---------------------------------------------------------------------------

@main.command("config")
@click.option("--repo", default=None, help="Shared git repo URL.")
@click.option("--branch", default=None, help="Branch to use (default: main).")
@click.option("--interval", type=int, default=None, help="Sync interval in seconds.")
@click.option("--name", default=None, help="Git author name.")
@click.option("--email", default=None, help="Git author email.")
@click.pass_context
def cmd_config(ctx, repo, branch, interval, name, email):
    """Show or update configuration."""
    cfg = cfg_mod.load()
    changed = False

    if repo:
        cfg.shared_repo_url = repo
        changed = True
    if branch:
        cfg.branch = branch
        changed = True
    if interval is not None:
        cfg.sync_interval = interval
        changed = True
    if name:
        cfg.author_name = name
        changed = True
    if email:
        cfg.author_email = email
        changed = True

    if changed:
        cfg_mod.save(cfg)
        click.echo("Configuration saved.")
    else:
        import dataclasses
        click.echo(json.dumps(dataclasses.asdict(cfg), indent=2))


# ---------------------------------------------------------------------------
# watch
# ---------------------------------------------------------------------------

@main.command("watch")
@click.option("--add", "add_path", default=None, metavar="PATH", help="Add a directory to watch.")
@click.option("--remove", "remove_path", default=None, metavar="PATH", help="Remove a directory.")
@click.option("--list", "list_dirs", is_flag=True, default=False, help="List watched directories.")
def cmd_watch(add_path, remove_path, list_dirs):
    """Manage the list of directories watched for CLAUDE.md changes."""
    cfg = cfg_mod.load()

    if add_path:
        p = str(Path(add_path).resolve())
        if p not in cfg.watch_dirs:
            cfg.watch_dirs.append(p)
            cfg_mod.save(cfg)
            click.echo(f"Added: {p}")
        else:
            click.echo(f"Already watching: {p}")

    elif remove_path:
        p = str(Path(remove_path).resolve())
        if p in cfg.watch_dirs:
            cfg.watch_dirs.remove(p)
            cfg_mod.save(cfg)
            click.echo(f"Removed: {p}")
        else:
            click.echo(f"Not in watch list: {p}")

    else:
        if not cfg.watch_dirs:
            click.echo("No directories configured.")
        else:
            for d in cfg.watch_dirs:
                click.echo(d)


# ---------------------------------------------------------------------------
# start (foreground daemon)
# ---------------------------------------------------------------------------

@main.command("start")
@click.pass_context
def cmd_start(ctx):
    """Start the sync daemon in the foreground."""
    cfg = cfg_mod.load()
    cfg_mod.require(cfg)
    daemon = Daemon(cfg)
    daemon.start()


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

@main.command("status")
def cmd_status():
    """Show current config and shared repo status."""
    cfg = cfg_mod.load()
    click.echo(f"Shared repo URL : {cfg.shared_repo_url or '(not set)'}")
    click.echo(f"Local clone     : {cfg.shared_repo_local}")
    click.echo(f"Branch          : {cfg.branch}")
    click.echo(f"Sync interval   : {cfg.sync_interval}s")
    click.echo(f"Author          : {cfg.author_name} <{cfg.author_email}>")
    click.echo(f"Watched dirs    : {len(cfg.watch_dirs)}")
    for d in cfg.watch_dirs:
        exists = "✓" if Path(d).exists() else "✗ (missing)"
        click.echo(f"  {exists}  {d}")

    if cfg.shared_repo_url and cfg.shared_repo_local:
        local = Path(cfg.shared_repo_local)
        if (local / ".git").exists():
            import git
            repo = git.Repo(cfg.shared_repo_local)
            try:
                sha = repo.head.commit.hexsha[:8]
                msg = repo.head.commit.message.splitlines()[0]
                click.echo(f"Latest commit   : {sha} {msg}")
            except ValueError:
                click.echo("Latest commit   : (none yet)")
        else:
            click.echo("Shared repo     : not cloned yet (run 'claude-share start')")


# ---------------------------------------------------------------------------
# pull  (one-shot manual pull)
# ---------------------------------------------------------------------------

@main.command("pull")
@click.pass_context
def cmd_pull(ctx):
    """Pull latest shared CLAUDE.md files right now (one-shot)."""
    cfg = cfg_mod.load()
    cfg_mod.require(cfg)
    repo = git_sync.clone_or_open(cfg)
    changed = git_sync.pull(repo, cfg)
    if not changed:
        click.echo("Already up to date.")
        return
    click.echo(f"{len(changed)} file(s) updated in shared repo.")
    for watch_dir in cfg.watch_dirs:
        p = Path(watch_dir)
        if p.exists():
            updated = git_sync.copy_shared_to_local(repo, p)
            if updated:
                click.echo(f"  Updated CLAUDE.md in {p}")


# ---------------------------------------------------------------------------
# push  (one-shot manual push)
# ---------------------------------------------------------------------------

@main.command("push")
@click.argument("project_dir", default=".", type=click.Path(exists=True))
@click.pass_context
def cmd_push(ctx, project_dir):
    """Push the CLAUDE.md from PROJECT_DIR to the shared repo right now."""
    cfg = cfg_mod.load()
    cfg_mod.require(cfg)
    p = Path(project_dir).resolve()
    claude_md = p / "CLAUDE.md"
    if not claude_md.exists():
        click.echo(f"No CLAUDE.md found in {p}", err=True)
        sys.exit(1)
    repo = git_sync.clone_or_open(cfg)
    committed = git_sync.update_shared_claude_md(repo, cfg, p, claude_md.read_text())
    if committed:
        ok = git_sync.push(repo, cfg)
        click.echo("Pushed." if ok else "Committed locally but push failed.")
    else:
        click.echo("No changes to push.")


# ---------------------------------------------------------------------------
# install-hooks  (wire Claude Code web session hooks)
# ---------------------------------------------------------------------------

@main.command("install-hooks")
@click.argument("project_dir", default=".", type=click.Path(exists=True))
@click.option("--remove", is_flag=True, default=False, help="Remove claude-sharing hooks instead of adding them.")
def cmd_install_hooks(project_dir, remove):
    """
    Install Claude Code session hooks in PROJECT_DIR so CLAUDE.md syncs
    automatically during web sessions.

    \b
    On SessionStart  → pulls the latest shared CLAUDE.md into this project
    On Stop          → pushes this project's CLAUDE.md to the shared repo

    This lets team members pick up each other's context automatically when
    they open a new Claude Code web session.
    """
    cfg = cfg_mod.load()
    cfg_mod.require(cfg)

    p = Path(project_dir).resolve()
    settings_path = p / ".claude" / "settings.json"
    settings_path.parent.mkdir(parents=True, exist_ok=True)

    # Load existing settings (if any)
    if settings_path.exists():
        with open(settings_path) as f:
            try:
                settings = json.load(f)
            except json.JSONDecodeError:
                settings = {}
    else:
        settings = {}

    hooks = settings.setdefault("hooks", {})

    if remove:
        _remove_sharing_hooks(hooks)
        with open(settings_path, "w") as f:
            json.dump(settings, f, indent=2)
        click.echo(f"Removed claude-sharing hooks from {settings_path}")
        return

    # The commands we inject — use absolute path to avoid PATH issues in web env
    pull_cmd = "claude-share pull"
    push_cmd = f"claude-share push {p}"

    _upsert_hook(hooks, "SessionStart", pull_cmd)
    _upsert_hook(hooks, "Stop", push_cmd)

    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)

    click.echo(f"Hooks installed in {settings_path}")
    click.echo("  SessionStart → claude-share pull  (fetch teammates' latest context)")
    click.echo(f"  Stop         → claude-share push  (share your context when done)")

    # Also register this directory as a watch dir so the daemon works too
    p_str = str(p)
    if p_str not in cfg.watch_dirs:
        cfg.watch_dirs.append(p_str)
        cfg_mod.save(cfg)
        click.echo(f"Added {p} to watch list for daemon sync.")


_HOOK_MARKER = "claude-sharing"


def _make_hook_entry(command: str) -> dict:
    return {"type": "command", "command": command}


def _upsert_hook(hooks: dict, event: str, command: str) -> None:
    """Add or update a claude-sharing hook entry for the given lifecycle event."""
    event_hooks = hooks.setdefault(event, [])

    # Find an existing claude-sharing block for this event
    for block in event_hooks:
        inner = block.get("hooks", [])
        for entry in inner:
            if _HOOK_MARKER in entry.get("command", ""):
                # Update in place
                entry["command"] = command
                return

    # No existing block — append a new one
    event_hooks.append({
        "matcher": "",
        "hooks": [_make_hook_entry(command)],
    })


def _remove_sharing_hooks(hooks: dict) -> None:
    """Strip all claude-sharing hook entries from the hooks dict."""
    for event in list(hooks.keys()):
        cleaned_blocks = []
        for block in hooks[event]:
            inner = [
                e for e in block.get("hooks", [])
                if _HOOK_MARKER not in e.get("command", "")
            ]
            if inner:
                block["hooks"] = inner
                cleaned_blocks.append(block)
        if cleaned_blocks:
            hooks[event] = cleaned_blocks
        else:
            del hooks[event]
