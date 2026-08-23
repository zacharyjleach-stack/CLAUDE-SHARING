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

export type PeerMessage =
  | HelloMsg
  | ChallengeMsg
  | AuthResponseMsg
  | AuthOkMsg
  | AuthFailMsg
  | ActivityMsg
  | TranscriptMsg;
