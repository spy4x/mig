// ULID generation + HMAC sign/verify for cancel tokens.
//
// ULIDs are 26-char Crockford base32, time-sortable, k-sorted.
// We use @std/ulid (single dep, official stdlib).

import { monotonicUlid } from "@std/ulid";

// Returns a fresh ULID. monotonicUlid ensures same-millisecond IDs are
// strictly increasing (no collisions under burst writes).
export function generateBookingId(): string {
  return monotonicUlid();
}

// Web-safe random bytes -> base64url string.
function randomBase64Url(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  // base64url: standard base64 with -_ instead of +/
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// HMAC a token using the cancel secret. Returns raw token (goes in
// email URL) and hex hash (stored on the booking). Verifying recomputes
// the HMAC and compares in constant time.
export async function newCancelToken(
  secret: string,
): Promise<{ raw: string; hash: string }> {
  const raw = randomBase64Url(16);
  const hash = await sha256Hex(raw + secret);
  return { raw, hash };
}

export async function verifyCancelToken(
  raw: string,
  hash: string,
  secret: string,
): Promise<boolean> {
  const computed = await sha256Hex(raw + secret);
  return constantTimeEqual(computed, hash);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
