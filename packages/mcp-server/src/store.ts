import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PEERS_DIR = join(homedir(), ".claude-sharing", "peers");

export interface PeerMeta {
  name: string;
  project?: string;
  connectedAt?: string;
  lastSeen?: string;
}

export interface ActivityEvent {
  ts: string;
  kind: "edit" | "write" | "bash" | "message" | "commit" | "other";
  summary: string;
  file?: string;
}

export interface TranscriptLine {
  ts: string;
  raw: unknown;
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // skip partially-written / corrupt lines
    }
  }
  return out;
}

export function listPeers(): PeerMeta[] {
  if (!existsSync(PEERS_DIR)) return [];
  return readdirSync(PEERS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const metaPath = join(PEERS_DIR, d.name, "meta.json");
      if (existsSync(metaPath)) {
        try {
          return JSON.parse(readFileSync(metaPath, "utf8")) as PeerMeta;
        } catch {
          // fall through to default
        }
      }
      return { name: d.name };
    });
}

function resolvePeerDir(name: string): string | null {
  const dir = join(PEERS_DIR, name);
  return existsSync(dir) ? dir : null;
}

export function getPeerActivity(
  name: string,
  opts: { since?: string; limit?: number } = {}
): ActivityEvent[] {
  const dir = resolvePeerDir(name);
  if (!dir) return [];
  let events = readJsonl<ActivityEvent>(join(dir, "activity.jsonl"));
  if (opts.since) {
    const sinceTs = new Date(opts.since).getTime();
    events = events.filter((e) => new Date(e.ts).getTime() >= sinceTs);
  }
  const limit = opts.limit ?? 50;
  return events.slice(-limit);
}

export function searchPeerTranscript(
  name: string,
  query: string,
  limit = 20
): TranscriptLine[] {
  const dir = resolvePeerDir(name);
  if (!dir) return [];
  const lines = readJsonl<TranscriptLine>(join(dir, "transcript.jsonl"));
  const needle = query.toLowerCase();
  const matches: TranscriptLine[] = [];
  for (let i = lines.length - 1; i >= 0 && matches.length < limit; i--) {
    const hay = JSON.stringify(lines[i].raw).toLowerCase();
    if (hay.includes(needle)) matches.push(lines[i]);
  }
  return matches.reverse();
}
