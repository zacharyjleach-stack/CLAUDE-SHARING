import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PEERS_DIR } from "../../shared/paths";
import { ActivityMsg, TranscriptMsg } from "../../shared/protocol";

function peerDir(name: string): string {
  const dir = join(PEERS_DIR, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function updatePeerMeta(name: string, patch: Record<string, unknown>): void {
  const metaPath = join(peerDir(name), "meta.json");
  let meta: Record<string, unknown> = { name };
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8"));
    } catch {
      // start fresh on corrupt meta
    }
  }
  writeFileSync(metaPath, JSON.stringify({ ...meta, ...patch, name }, null, 2));
}

export function persistIncomingActivity(name: string, event: ActivityMsg["event"]): void {
  appendFileSync(join(peerDir(name), "activity.jsonl"), JSON.stringify(event) + "\n");
  updatePeerMeta(name, { lastSeen: new Date().toISOString() });
}

export function persistIncomingTranscript(name: string, msg: TranscriptMsg): void {
  appendFileSync(
    join(peerDir(name), "transcript.jsonl"),
    JSON.stringify({ ts: msg.ts, raw: msg.raw }) + "\n"
  );
}
