// Content script for claude.ai/code pages.
//
// IMPORTANT: claude.ai's DOM isn't a published, stable API, so the
// selectors below are best-effort heuristics, not guaranteed matches. If
// prompts/activity aren't being picked up, open devtools on a claude.ai/code
// tab, find the real selector for the prompt box / message list, and adjust
// COMPOSER_SELECTORS / MESSAGE_SELECTORS below.

const COMPOSER_SELECTORS = [
  'div[contenteditable="true"]',
  'textarea[placeholder]',
  'div[role="textbox"]',
];

const MESSAGE_CONTAINER_SELECTORS = ['main', '[role="main"]', 'body'];

function findComposer() {
  for (const sel of COMPOSER_SELECTORS) {
    const els = Array.from(document.querySelectorAll(sel)).filter(isVisible);
    if (els.length > 0) return els[els.length - 1];
  }
  return null;
}

function isVisible(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function sendToBackground(msg) {
  try {
    chrome.runtime.sendMessage(msg);
  } catch {
    // extension context invalidated (e.g. just reloaded) — ignore
  }
}

// ---------------------------------------------------------------------------
// Capture outgoing prompts
// ---------------------------------------------------------------------------

function composerText(el) {
  if (!el) return "";
  return "value" in el ? el.value : el.textContent || "";
}

function captureAndSendPrompt(el) {
  const text = composerText(el).trim();
  if (!text) return;
  sendToBackground({ type: "ext-prompt", text, ts: new Date().toISOString() });
}

document.addEventListener(
  "keydown",
  (ev) => {
    if (ev.key !== "Enter" || ev.shiftKey) return;
    const el = findComposer();
    if (el && document.activeElement === el) captureAndSendPrompt(el);
  },
  true
);

document.addEventListener(
  "click",
  (ev) => {
    const target = ev.target.closest?.('button[aria-label*="Send" i], button[type="submit"]');
    if (!target) return;
    const el = findComposer();
    if (el) captureAndSendPrompt(el);
  },
  true
);

// ---------------------------------------------------------------------------
// Best-effort "assistant activity" signal: debounce bursts of new text
// appearing in the main content area after a prompt was sent.
// ---------------------------------------------------------------------------

let activityTimer = null;
let lastPromptAt = 0;

const observerTarget = MESSAGE_CONTAINER_SELECTORS.map((s) => document.querySelector(s)).find(Boolean) || document.body;

new MutationObserver(() => {
  if (Date.now() - lastPromptAt > 120_000) return; // only report activity shortly after a prompt
  if (activityTimer) clearTimeout(activityTimer);
  activityTimer = setTimeout(() => {
    sendToBackground({
      type: "ext-activity",
      summary: "Claude is responding…",
      ts: new Date().toISOString(),
    });
  }, 800);
}).observe(observerTarget, { childList: true, subtree: true });

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) lastPromptAt = Date.now();
});

// ---------------------------------------------------------------------------
// Repo detection (manual override wins; falls back to a guess from the page)
// ---------------------------------------------------------------------------

function guessRepoFromPage() {
  const candidates = [document.title, ...Array.from(document.querySelectorAll("header, h1, h2")).map((e) => e.textContent || "")];
  for (const text of candidates) {
    const match = text.match(/\b([\w.-]+)\/([\w.-]+)\b/);
    if (match) return `${match[1]}/${match[2]}`.toLowerCase();
  }
  return null;
}

function reportRepo() {
  chrome.storage.local.get(["manualRepo"], ({ manualRepo }) => {
    const repo = (manualRepo && manualRepo.trim()) || guessRepoFromPage();
    sendToBackground({ type: "ext-repo", repo: repo || null });
  });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.manualRepo) reportRepo();
});

reportRepo();
setInterval(reportRepo, 30_000);

// ---------------------------------------------------------------------------
// Overlay: show the teammate's latest live activity, with a one-click way
// to mention it to Claude (fills the composer — never auto-submits).
// ---------------------------------------------------------------------------

function ensureOverlay() {
  let el = document.getElementById("claude-sharing-overlay");
  if (el) return el;
  el = document.createElement("div");
  el.id = "claude-sharing-overlay";
  Object.assign(el.style, {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    maxWidth: "320px",
    background: "#1c1c1e",
    color: "white",
    padding: "10px 12px",
    borderRadius: "10px",
    fontSize: "13px",
    fontFamily: "sans-serif",
    zIndex: 999999,
    boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
    display: "none",
  });
  document.body.appendChild(el);
  return el;
}

function setComposerText(el, text) {
  if (!el) return;
  if ("value" in el) {
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    el.textContent = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
  el.focus();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "teammate-update") return;
  const overlay = ensureOverlay();
  const prefix = msg.sameRepo ? "Same repo" : "Different repo";
  overlay.innerHTML = "";
  overlay.style.display = "block";

  const label = document.createElement("div");
  label.textContent = `${prefix} — ${msg.peerName}: ${msg.event.summary}`;
  label.style.marginBottom = "8px";
  overlay.appendChild(label);

  const btn = document.createElement("button");
  btn.textContent = "Mention to Claude";
  Object.assign(btn.style, {
    background: "#d97757",
    color: "white",
    border: "none",
    borderRadius: "6px",
    padding: "5px 10px",
    cursor: "pointer",
    fontSize: "12px",
  });
  btn.addEventListener("click", () => {
    setComposerText(findComposer(), `FYI — ${msg.peerName} just: ${msg.event.summary}`);
    overlay.style.display = "none";
  });
  overlay.appendChild(btn);

  setTimeout(() => {
    if (overlay.style.display === "block") overlay.style.display = "none";
  }, 20_000);
});
