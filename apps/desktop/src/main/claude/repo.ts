import { execFileSync } from "node:child_process";

/**
 * Best-effort "owner/repo" slug for a local project directory's GitHub
 * origin remote, used to detect when two paired teammates are working on
 * the same repo. Returns null if there's no git repo, no origin, or the
 * origin isn't a recognizable GitHub URL.
 */
export function detectRepoSlug(projectDir: string): string | null {
  try {
    const url = execFileSync("git", ["-C", projectDir, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return normalizeGithubUrl(url);
  } catch {
    return null;
  }
}

export function normalizeGithubUrl(url: string): string | null {
  const match = url.match(/github\.com[:/]+([^/]+)\/([^/.]+?)(\.git)?\/?$/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`.toLowerCase();
}
