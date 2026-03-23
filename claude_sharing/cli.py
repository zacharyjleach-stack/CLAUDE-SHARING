"""CLI entry point for claude-sharing."""

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
        import json, dataclasses
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
