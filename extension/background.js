// Background service worker: owns the WebSocket to the Claude Sharing
// desktop app (ws://127.0.0.1:8347) and relays messages both ways.
//
// MV3 service workers get killed after ~30s idle, which drops the socket.
// There's no way around that in MV3 — the periodic alarm below just makes
// sure we reconnect quickly rather than staying dark indefinitely. In
// practice that means "near-real-time, self-healing within ~30s", not a
// guaranteed persistent connection.

const WS_URL = "ws://127.0.0.1:8347";
let socket = null;

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    socket = new WebSocket(WS_URL);
  } catch {
    socket = null;
    return;
  }

  socket.onopen = () => chrome.action.setBadgeText({ text: "" });

  socket.onclose = () => {
    socket = null;
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#999999" });
  };

  socket.onerror = () => {
    try {
      socket?.close();
    } catch {
      // already closing
    }
  };

  socket.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    chrome.tabs.query({ url: "https://claude.ai/*" }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id != null) {
          chrome.tabs.sendMessage(tab.id, msg).catch(() => {
            // tab has no content script listening (e.g. not on a /code page) — ignore
          });
        }
      }
    });
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "get-status") {
    sendResponse({ connected: Boolean(socket && socket.readyState === WebSocket.OPEN) });
    return;
  }
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
});

chrome.alarms.create("claude-sharing-reconnect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(connect);

connect();
