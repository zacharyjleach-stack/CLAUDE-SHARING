import { ipcRenderer } from "electron";
import { Session } from "./pairing";
import { PeerMessage } from "../shared/protocol";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const session = new Session();
let projectDir: string | null = null;

function logFeed(text: string): void {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
  const feed = $("activity-feed");
  feed.prepend(li);
  while (feed.childElementCount > 200) feed.removeChild(feed.lastChild as Node);
}

function setStatusText(text: string): void {
  $("status-text").textContent = text;
}

// ---------------------------------------------------------------------------
// Project selection
// ---------------------------------------------------------------------------

$("project-dir-btn").addEventListener("click", async () => {
  const result = await ipcRenderer.invoke("select-project-dir");
  if (result) {
    projectDir = result.projectDir;
    $("project-dir-label").textContent = projectDir;
    logFeed(`Watching ${projectDir} for Claude Code activity.`);
  }
});

// Forward this machine's new transcript lines to the connected teammate.
ipcRenderer.on("outgoing-line", (_evt, { raw, event }) => {
  if (session.status !== "connected") return;
  session.send({ type: "transcript", ts: new Date().toISOString(), raw });
  if (event) {
    session.send({ type: "activity", event });
    logFeed(`(you) ${event.summary}`);
  }
});

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

$("host-btn").addEventListener("click", () => {
  const name = ($("your-name") as HTMLInputElement).value.trim() || "me";
  const password = ($("host-password") as HTMLInputElement).value;
  if (!password) {
    setStatusText("Set a password before hosting.");
    return;
  }
  const code = session.host(name, password);
  $("host-code-display").textContent = code;
  $("host-code-display").hidden = false;
  setStatusText("Waiting for your teammate to join…");
});

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

$("join-btn").addEventListener("click", () => {
  const name = ($("your-name") as HTMLInputElement).value.trim() || "me";
  const code = ($("join-code") as HTMLInputElement).value.trim().toUpperCase();
  const password = ($("join-password") as HTMLInputElement).value;
  if (!code || !password) {
    setStatusText("Enter both the session code and password.");
    return;
  }
  session.join(code, password, name);
  setStatusText("Connecting…");
});

// ---------------------------------------------------------------------------
// Session events
// ---------------------------------------------------------------------------

session.on("status", (status: string) => {
  const map: Record<string, string> = {
    idle: "Not connected.",
    "waiting-for-join": "Waiting for your teammate to join…",
    connecting: "Connecting…",
    authenticating: "Verifying password…",
    connected: `Connected to ${session.peerName}.`,
    failed: "Connection failed.",
  };
  setStatusText(map[status] ?? status);
});

session.on("connected", (peerName: string) => {
  ipcRenderer.send("peer-connected", peerName);
  logFeed(`Connected to ${peerName}. Their Claude Code activity will appear here in real time.`);
  $("mcp-hint").hidden = false;
});

session.on("error", (reason: string) => {
  logFeed(`Error: ${reason}`);
});

session.on("peer-data", (peerName: string, data: PeerMessage) => {
  ipcRenderer.send("peer-data", peerName, data);
  if (data.type === "activity") {
    logFeed(`(${peerName}) ${data.event.summary}`);
  }
});
