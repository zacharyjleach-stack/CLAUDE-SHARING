import { ActivityMsg } from "../../shared/protocol";

type Activity = ActivityMsg["event"];

const EDIT_TOOLS = new Set(["Edit", "MultiEdit"]);

/**
 * Best-effort summary of a raw Claude Code transcript line into a compact
 * activity event. Claude Code's jsonl schema isn't a stable public API, so
 * this stays defensive: anything it doesn't recognize falls back to "other"
 * rather than throwing.
 */
export function deriveActivityEvent(raw: any): Activity | null {
  try {
    const ts = raw?.timestamp ?? new Date().toISOString();
    const content = raw?.message?.content;
    if (!Array.isArray(content)) {
      if (typeof raw?.message?.content === "string" && raw.message.content.trim()) {
        return { ts, kind: "message", summary: truncate(raw.message.content) };
      }
      return null;
    }

    for (const block of content) {
      if (block?.type === "tool_use") {
        const name = block.name as string;
        const input = block.input ?? {};
        if (EDIT_TOOLS.has(name)) {
          return {
            ts,
            kind: "edit",
            file: input.file_path,
            summary: `edited ${input.file_path ?? "a file"}`,
          };
        }
        if (name === "Write") {
          return {
            ts,
            kind: "write",
            file: input.file_path,
            summary: `wrote ${input.file_path ?? "a file"}`,
          };
        }
        if (name === "Bash") {
          return { ts, kind: "bash", summary: `ran: ${truncate(input.command ?? "", 120)}` };
        }
        return { ts, kind: "other", summary: `used tool ${name}` };
      }
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        return { ts, kind: "message", summary: truncate(block.text) };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
