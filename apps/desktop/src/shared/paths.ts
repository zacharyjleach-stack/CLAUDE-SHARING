import { homedir } from "node:os";
import { join } from "node:path";

/** Root of every claude-sharing state directory (~/.claude-sharing). */
export const STATE_DIR = join(homedir(), ".claude-sharing");

/** Where synced teammate data (activity + transcripts) is written. */
export const PEERS_DIR = join(STATE_DIR, "peers");

/** Claude Code's own per-project transcript storage. */
export const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");

/**
 * Claude Code stores each project's transcripts under a folder named by
 * replacing path separators in the absolute project path with dashes,
 * e.g. /home/user/foo -> -home-user-foo.
 */
export function sanitizeProjectPath(absPath: string): string {
  return absPath.replace(/[\\/]/g, "-");
}
