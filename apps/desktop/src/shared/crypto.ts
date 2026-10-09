import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const PBKDF2_ITERATIONS = 100_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

/** A short, easy-to-read-aloud session code (this is NOT the secret — the password is). */
export function generateSessionCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Derive a shared 32-byte key from the session code + password. Both peers
 * compute this independently once they agree on the code (the connection
 * rendezvous point) and the password (never sent over the wire).
 */
export function deriveSharedKey(code: string, password: string): Buffer {
  return pbkdf2Sync(password, `claude-sharing:${code}`, PBKDF2_ITERATIONS, 32, "sha256");
}

export function hmac(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

export function verifyHmac(key: Buffer, data: string, signature: string): boolean {
  const expected = Buffer.from(hmac(key, data), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function randomNonce(): string {
  return randomBytes(16).toString("hex");
}
