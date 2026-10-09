import { BrowserWindow, dialog, ipcMain, screen } from "electron";
import { persistIncomingActivity, persistIncomingTranscript, updatePeerMeta } from "./claude/activityStore";
import { deriveActivityEvent } from "./claude/deriveActivity";
import { ensureMcpServerRegistered } from "./claude/mcpSetup";
import { detectRepoSlug } from "./claude/repo";
import { TranscriptWatcher } from "./claude/transcriptWatcher";
import { ExtensionBridge } from "./bridge/wsServer";
import { ExtensionMessage, PeerMessage } from "../shared/protocol";

let watcher: TranscriptWatcher | null = null;
const bridge = new ExtensionBridge();

// This machine's current repo, from whichever source last reported one
// (the CLI project-folder picker, or the browser extension watching a
// claude.ai/code tab) — and the teammate's, from their presence message.
let myRepo: string | null = null;
let peerRepo: string | null = null;

function truncate(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export function registerIpcHandlers(win: BrowserWindow): void {
  ipcMain.handle("select-project-dir", async () => {
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const projectDir = result.filePaths[0];

    ensureMcpServerRegistered(projectDir);

    myRepo = detectRepoSlug(projectDir);
    win.webContents.send("local-repo", myRepo);

    watcher?.stop();
    watcher = new TranscriptWatcher(projectDir);
    watcher.on("line", ({ raw }) => {
      const event = deriveActivityEvent(raw);
      win.webContents.send("outgoing-line", { raw, event });
    });
    watcher.start();

    return { projectDir, repo: myRepo };
  });

  ipcMain.on("peer-connected", (_evt, name: string) => {
    updatePeerMeta(name, { connectedAt: new Date().toISOString(), lastSeen: new Date().toISOString() });
  });

  ipcMain.on("peer-repo", (_evt, repo: string | null) => {
    peerRepo = repo;
  });

  ipcMain.on("peer-data", (_evt, name: string, message: PeerMessage) => {
    if (message.type === "activity") {
      persistIncomingActivity(name, message.event);
      const sameRepo = Boolean(myRepo && peerRepo && myRepo === peerRepo);
      bridge.broadcast({ type: "teammate-update", peerName: name, sameRepo, event: message.event });
    } else if (message.type === "transcript") {
      persistIncomingTranscript(name, message);
      updatePeerMeta(name, { lastSeen: new Date().toISOString() });
    }
  });

  // --- Window chrome: frameless widget, so the renderer drives resize/move ---
  ipcMain.on("window-control", (_evt, action: string) => {
    const display = screen.getPrimaryDisplay().workArea;
    switch (action) {
      case "half-left":
        win.setBounds({ x: display.x, y: display.y, width: Math.floor(display.width / 2), height: display.height });
        break;
      case "half-right":
        win.setBounds({
          x: display.x + Math.ceil(display.width / 2),
          y: display.y,
          width: Math.floor(display.width / 2),
          height: display.height,
        });
        break;
      case "compact":
        win.setBounds({ x: display.x + 40, y: display.y + 40, width: 360, height: 480 });
        break;
      case "normal":
        win.setBounds({ x: display.x + 80, y: display.y + 80, width: 900, height: 640 });
        break;
      case "toggle-always-on-top":
        win.setAlwaysOnTop(!win.isAlwaysOnTop());
        break;
      case "minimize":
        win.minimize();
        break;
      case "close":
        win.close();
        break;
    }
  });

  // --- Browser extension bridge (watches claude.ai/code tabs) ---
  bridge.on("message", (msg: ExtensionMessage) => {
    if (msg.type === "ext-repo") {
      myRepo = msg.repo;
      win.webContents.send("local-repo", myRepo);
      return;
    }
    if (msg.type === "ext-prompt") {
      const event = { ts: msg.ts, kind: "message" as const, summary: `prompted: ${truncate(msg.text)}` };
      win.webContents.send("outgoing-line", { raw: msg, event });
      return;
    }
    if (msg.type === "ext-activity") {
      const event = { ts: msg.ts, kind: "other" as const, summary: msg.summary };
      win.webContents.send("outgoing-line", { raw: msg, event });
    }
  });
}
