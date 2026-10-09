import { EventEmitter } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { ExtensionMessage, TeammateUpdateMsg } from "../../shared/protocol";

export const BRIDGE_PORT = 8347;

/**
 * Local-only WebSocket server the browser extension (content/background
 * script watching a claude.ai/code tab) connects to. Nothing here ever
 * leaves the machine — only loopback connections are accepted.
 */
export class ExtensionBridge extends EventEmitter {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor() {
    super();
    this.wss = new WebSocketServer({ host: "127.0.0.1", port: BRIDGE_PORT });
    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as ExtensionMessage;
          this.emit("message", msg);
        } catch {
          // ignore malformed payloads from the extension
        }
      });
      ws.on("close", () => this.clients.delete(ws));
    });
    this.wss.on("error", (err) => this.emit("error", err));
  }

  broadcast(msg: TeammateUpdateMsg): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }

  close(): void {
    this.wss.close();
  }
}
