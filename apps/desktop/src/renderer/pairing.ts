import { EventEmitter } from "node:events";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Peer } = require("peerjs") as typeof import("peerjs");
import { deriveSharedKey, generateSessionCode, hmac, randomNonce, verifyHmac } from "../shared/crypto";
import { PeerMessage } from "../shared/protocol";

export type SessionStatus =
  | "idle"
  | "waiting-for-join"
  | "connecting"
  | "authenticating"
  | "connected"
  | "failed";

/**
 * Owns the single WebRTC (PeerJS) connection to a paired teammate: pairing
 * code + password handshake, then a plain send/receive channel for activity
 * and transcript messages. Runs entirely peer-to-peer once connected — the
 * public PeerJS cloud broker is only used to exchange the initial
 * connection offer, never to relay app data.
 */
export class Session extends EventEmitter {
  private peer: any = null;
  private conn: any = null;
  private sharedKey: Buffer | null = null;
  private myName = "";
  status: SessionStatus = "idle";
  peerName: string | null = null;

  private setStatus(s: SessionStatus) {
    this.status = s;
    this.emit("status", s);
  }

  host(name: string, password: string): string {
    this.myName = name;
    const code = generateSessionCode();
    this.sharedKey = deriveSharedKey(code, password);

    this.peer = new Peer(`claude-sharing-${code}`);
    this.setStatus("waiting-for-join");

    this.peer.on("error", (err: Error) => this.fail(err.message));
    this.peer.on("connection", (conn: any) => {
      this.conn = conn;
      this.setStatus("authenticating");
      conn.on("open", () => {
        const nonce = randomNonce();
        this.send({ type: "challenge", nonce });
        conn.once("data", (data: PeerMessage) => this.handleAuthResponse(data, nonce));
      });
      conn.on("error", (err: Error) => this.fail(err.message));
    });

    return code;
  }

  join(code: string, password: string, name: string): void {
    this.myName = name;
    this.sharedKey = deriveSharedKey(code, password);

    this.peer = new Peer();
    this.setStatus("connecting");

    this.peer.on("error", (err: Error) => this.fail(err.message));
    this.peer.on("open", () => {
      const conn = this.peer.connect(`claude-sharing-${code}`, { reliable: true });
      this.conn = conn;
      conn.on("open", () => {
        this.setStatus("authenticating");
        this.send({ type: "hello", name: this.myName });
      });
      conn.on("data", (data: PeerMessage) => this.handleAsJoiner(data));
      conn.on("error", (err: Error) => this.fail(err.message));
    });
  }

  private handleAuthResponse(data: PeerMessage, nonce: string): void {
    if (data.type !== "auth-response" || !this.sharedKey) {
      this.fail("Unexpected handshake message.");
      return;
    }
    if (!verifyHmac(this.sharedKey, nonce, data.proof)) {
      this.send({ type: "auth-fail", reason: "Wrong password." });
      this.fail("Teammate provided the wrong password.");
      return;
    }
    this.peerName = data.name;
    this.send({ type: "auth-ok", name: this.myName });
    this.becomeConnected();
  }

  private handleAsJoiner(data: PeerMessage): void {
    if (data.type === "challenge" && this.sharedKey) {
      const proof = hmac(this.sharedKey, data.nonce);
      this.send({ type: "auth-response", proof, name: this.myName });
      return;
    }
    if (data.type === "auth-ok") {
      this.peerName = data.name;
      this.becomeConnected();
      return;
    }
    if (data.type === "auth-fail") {
      this.fail(data.reason);
      return;
    }
    this.handleAppMessage(data);
  }

  private becomeConnected(): void {
    this.setStatus("connected");
    this.emit("connected", this.peerName);
    this.conn.removeAllListeners("data");
    this.conn.on("data", (data: PeerMessage) => this.handleAppMessage(data));
  }

  private handleAppMessage(data: PeerMessage): void {
    if (data.type === "activity" || data.type === "transcript") {
      this.emit("peer-data", this.peerName, data);
    }
  }

  private fail(reason: string): void {
    this.setStatus("failed");
    this.emit("error", reason);
    this.conn?.close();
  }

  send(msg: PeerMessage): void {
    if (this.conn?.open) this.conn.send(msg);
  }

  close(): void {
    this.conn?.close();
    this.peer?.destroy();
    this.setStatus("idle");
  }
}
