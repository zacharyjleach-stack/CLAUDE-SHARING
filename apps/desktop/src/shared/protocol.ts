/** Messages exchanged over the WebRTC data channel between two paired peers. */

export interface HelloMsg {
  type: "hello";
  name: string;
}

export interface ChallengeMsg {
  type: "challenge";
  nonce: string;
}

export interface AuthResponseMsg {
  type: "auth-response";
  proof: string; // hmac(sharedKey, nonce)
  name: string;
}

export interface AuthOkMsg {
  type: "auth-ok";
  name: string;
}

export interface AuthFailMsg {
  type: "auth-fail";
  reason: string;
}

export interface ActivityMsg {
  type: "activity";
  event: {
    ts: string;
    kind: "edit" | "write" | "bash" | "message" | "commit" | "other";
    summary: string;
    file?: string;
  };
}

export interface TranscriptMsg {
  type: "transcript";
  ts: string;
  raw: unknown;
}

/** Announces (or updates) which repo this side is currently working on. */
export interface PresenceMsg {
  type: "presence";
  repo: string | null; // normalized "owner/repo", or null if unknown
}

export type PeerMessage =
  | HelloMsg
  | ChallengeMsg
  | AuthResponseMsg
  | AuthOkMsg
  | AuthFailMsg
  | ActivityMsg
  | TranscriptMsg
  | PresenceMsg;

// ---------------------------------------------------------------------------
// Local bridge protocol: messages between the browser extension (watching a
// claude.ai/code tab) and this desktop app's local WebSocket server. These
// never leave the machine except where explicitly turned into a PeerMessage
// above and sent to the paired teammate.
// ---------------------------------------------------------------------------

export interface ExtensionPromptMsg {
  type: "ext-prompt";
  text: string;
  ts: string;
}

export interface ExtensionActivityMsg {
  type: "ext-activity";
  summary: string;
  ts: string;
}

export interface ExtensionRepoMsg {
  type: "ext-repo";
  repo: string | null;
}

export type ExtensionMessage = ExtensionPromptMsg | ExtensionActivityMsg | ExtensionRepoMsg;

/** Sent from the desktop app down to the extension, to render in-page. */
export interface TeammateUpdateMsg {
  type: "teammate-update";
  peerName: string;
  sameRepo: boolean;
  event: ActivityMsg["event"];
}
