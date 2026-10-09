import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { registerIpcHandlers } from "./ipc";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 300,
    minHeight: 200,
    title: "Claude Sharing",
    frame: false,
    resizable: true,
    webPreferences: {
      // Trusted local app, no remote content is ever loaded — nodeIntegration
      // is enabled so the renderer can drive WebRTC (peerjs) and talk to the
      // filesystem directly instead of routing everything through a preload
      // bridge.
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
  });

  registerIpcHandlers(win);
  win.loadFile(join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
