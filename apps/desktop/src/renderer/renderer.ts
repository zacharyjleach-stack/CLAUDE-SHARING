import { ipcRenderer } from "electron";
import { Session } from "./pairing";
import { PeerMessage } from "../shared/protocol";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const session = new Session();
let myRepo: string | null = null;
let peerRepo: string | null = null;
let connectedAt = 0;
let timerHandle: number | undefined;

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

function notify(title: string, body: string): void {
  try {
    // eslint-disable-next-line no-new
    new Notification(title, { body });
  } catch {
    // notifications unavailable/denied on this platform — degrade silently
  }
}

function updateRepoBanner(): void {
  const banner = $("repo-banner");
  if (!myRepo || !peerRepo) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  if (myRepo === peerRepo) {
    banner.textContent = `Same repo (${myRepo}) — live awareness is on.`;
    banner.className = "banner banner-match";
  } else {
    banner.textContent = `Different repos (you: ${myRepo}, them: ${peerRepo}).`;
    banner.className = "banner banner-mismatch";
  }
}

// ---------------------------------------------------------------------------
// Lobby <-> call view switching
// ---------------------------------------------------------------------------

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `Connected · ${mm}:${ss}`;
}

function tickTimer(): void {
  $("call-timer").textContent = formatElapsed(Date.now() - connectedAt);
}

function showCallView(peerName: string): void {
  $("lobby-view").hidden = true;
  $("call-view").hidden = false;

  $("peer-avatar").textContent = (peerName || "?").trim().charAt(0).toUpperCase() || "?";
  $("call-peer-name").textContent = peerName;

  connectedAt = Date.now();
  tickTimer();
  if (timerHandle) window.clearInterval(timerHandle);
  timerHandle = window.setInterval(tickTimer, 1000);
}

function showLobbyView(): void {
  $("call-view").hidden = true;
  $("lobby-view").hidden = false;

  if (timerHandle) {
    window.clearInterval(timerHandle);
    timerHandle = undefined;
  }
  $("host-code-display").hidden = true;
  peerRepo = null;
  updateRepoBanner();
}

// ---------------------------------------------------------------------------
// Window chrome (frameless widget)
// ---------------------------------------------------------------------------

document.querySelectorAll<HTMLElement>("[data-window-action]").forEach((el) => {
  el.addEventListener("click", () => {
    ipcRenderer.send("window-control", el.dataset.windowAction);
  });
});

// ---------------------------------------------------------------------------
// Project selection (local Claude Code CLI path)
// ---------------------------------------------------------------------------

$("project-dir-btn").addEventListener("click", async () => {
  const result = await ipcRenderer.invoke("select-project-dir");
  if (result) {
    $("project-dir-label").textContent = result.projectDir;
    logFeed(`Watching ${result.projectDir} for Claude Code activity.`);
  }
});

// This machine's current repo, reported by either the CLI folder picker or
// the browser extension (whichever last reported one).
ipcRenderer.on("local-repo", (_evt, repo: string | null) => {
  myRepo = repo;
  updateRepoBanner();
  if (session.status === "connected") session.sendPresence(myRepo);
});

// Forward newly-detected local activity (CLI transcript lines, or extension
// events relayed through main) to the connected teammate.
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
// End Connection
// ---------------------------------------------------------------------------

$("end-call-btn").addEventListener("click", () => {
  session.close();
  setStatusText("Not connected.");
  showLobbyView();
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
  logFeed(`Connected to ${peerName}. Their Claude activity will appear here in real time.`);
  session.sendPresence(myRepo);
  showCallView(peerName);
  notify(`Connected to ${peerName}`, "Claude activity will sync live from here.");
});

session.on("peer-disconnected", (peerName: string | null) => {
  const name = peerName ?? "Your teammate";
  logFeed(`${name} disconnected.`);
  notify(`${name} disconnected`, "The connection ended.");
  showLobbyView();
});

session.on("error", (reason: string) => {
  logFeed(`Error: ${reason}`);
  setStatusText(reason);
});

session.on("peer-data", (peerName: string, data: PeerMessage) => {
  ipcRenderer.send("peer-data", peerName, data);
  if (data.type === "activity") {
    logFeed(`(${peerName}) ${data.event.summary}`);
    if (!document.hasFocus()) {
      notify(peerName, data.event.summary);
    }
  }
});

session.on("peer-presence", (_peerName: string, repo: string | null) => {
  peerRepo = repo;
  ipcRenderer.send("peer-repo", repo);
  updateRepoBanner();
});
