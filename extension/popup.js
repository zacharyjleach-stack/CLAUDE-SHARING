const statusEl = document.getElementById("status");
const input = document.getElementById("manual-repo");

chrome.runtime.sendMessage({ type: "get-status" }, (res) => {
  if (chrome.runtime.lastError || !res) {
    statusEl.textContent = "Not connected to desktop app";
    statusEl.className = "bad";
    return;
  }
  statusEl.textContent = res.connected ? "Connected to desktop app" : "Not connected to desktop app";
  statusEl.className = res.connected ? "ok" : "bad";
});

chrome.storage.local.get(["manualRepo"], ({ manualRepo }) => {
  if (manualRepo) input.value = manualRepo;
});

document.getElementById("save").addEventListener("click", () => {
  chrome.storage.local.set({ manualRepo: input.value.trim() });
});
