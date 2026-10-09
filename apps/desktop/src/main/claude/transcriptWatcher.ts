import { EventEmitter } from "node:events";
import { existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import chokidar, { FSWatcher } from "chokidar";
import { CLAUDE_PROJECTS_DIR, sanitizeProjectPath } from "../../shared/paths";

export interface TranscriptEvent {
  file: string;
  raw: unknown;
}

/**
 * Tails newly-appended lines from this project's Claude Code transcript
 * (~/.claude/projects/<sanitized-cwd>/*.jsonl) and emits one "line" event
 * per new JSON record.
 */
export class TranscriptWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private offsets = new Map<string, number>();

  constructor(private projectDir: string) {
    super();
  }

  start(): void {
    const dir = join(CLAUDE_PROJECTS_DIR, sanitizeProjectPath(this.projectDir));
    if (!existsSync(dir)) {
      // Nothing recorded yet for this project — that's fine, chokidar will
      // pick files up as soon as Claude Code creates them.
    }
    this.watcher = chokidar.watch(join(dir, "*.jsonl"), {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    });
    this.watcher.on("add", (file) => this.readNew(file));
    this.watcher.on("change", (file) => this.readNew(file));
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private readNew(file: string): void {
    try {
      const size = statSync(file).size;
      const start = this.offsets.get(file) ?? 0;
      if (size <= start) {
        this.offsets.set(file, size);
        return;
      }
      const fd = openSync(file, "r");
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      this.offsets.set(file, size);
      const text = buf.toString("utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          this.emit("line", { file, raw: JSON.parse(trimmed) } as TranscriptEvent);
        } catch {
          // partial line at EOF — will be re-read next time offset catches up
        }
      }
    } catch {
      // file may have been rotated/removed mid-read; ignore and wait for next event
    }
  }
}
