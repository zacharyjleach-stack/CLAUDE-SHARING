import { ipcRenderer } from "electron";
import { Session } from "./pairing";
import { PeerMessage } from "../shared/protocol";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const session = new Session();
let myRepo: string | null = null;
let peerRepo: string | null = null;

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
  $("mcp-hint").hidden = false;
  session.sendPresence(myRepo);
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

session.on("peer-presence", (_peerName: string, repo: string | null) => {
  peerRepo = repo;
  ipcRenderer.send("peer-repo", repo);
  updateRepoBanner();
});
