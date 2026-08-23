import { BrowserWindow, dialog, ipcMain } from "electron";
import { persistIncomingActivity, persistIncomingTranscript, updatePeerMeta } from "./claude/activityStore";
import { deriveActivityEvent } from "./claude/deriveActivity";
import { ensureMcpServerRegistered } from "./claude/mcpSetup";
import { TranscriptWatcher } from "./claude/transcriptWatcher";
import { PeerMessage } from "../shared/protocol";

let watcher: TranscriptWatcher | null = null;

export function registerIpcHandlers(win: BrowserWindow): void {
  ipcMain.handle("select-project-dir", async () => {
    const result = await dialog.showOpenDialog(win, { properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const projectDir = result.filePaths[0];

    ensureMcpServerRegistered(projectDir);

    watcher?.stop();
    watcher = new TranscriptWatcher(projectDir);
    watcher.on("line", ({ raw }) => {
      const event = deriveActivityEvent(raw);
      win.webContents.send("outgoing-line", { raw, event });
    });
    watcher.start();

    return { projectDir };
  });

  ipcMain.on("peer-connected", (_evt, name: string) => {
    updatePeerMeta(name, { connectedAt: new Date().toISOString(), lastSeen: new Date().toISOString() });
  });

  ipcMain.on("peer-data", (_evt, name: string, message: PeerMessage) => {
    if (message.type === "activity") {
      persistIncomingActivity(name, message.event);
    } else if (message.type === "transcript") {
      persistIncomingTranscript(name, message);
      updatePeerMeta(name, { lastSeen: new Date().toISOString() });
    }
  });
}
