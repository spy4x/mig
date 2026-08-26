import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import {
  generateBookingId,
  newCancelToken,
  verifyCancelToken,
} from "../lib/tokens.ts";

Deno.test("generateBookingId — ULID format and monotonicity", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const id = generateBookingId();
    assertEquals(id.length, 26);
    assertEquals(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id), true);
    assertEquals(ids.has(id), false);
    ids.add(id);
  }
  // monotonicUlid must be strictly non-decreasing within the same ms
  const a = generateBookingId();
  const b = generateBookingId();
  assertEquals(b >= a, true);
});

Deno.test("newCancelToken + verifyCancelToken roundtrip", async () => {
  const secret = "test-secret-1234567890";
  const { raw, hash } = await newCancelToken(secret);
  assertExists(raw);
  assertExists(hash);
  assertEquals(hash.length, 64); // SHA-256 hex
  assertEquals(await verifyCancelToken(raw, hash, secret), true);
});

Deno.test("verifyCancelToken — wrong secret fails", async () => {
  const { raw, hash } = await newCancelToken("secret-a");
  assertEquals(await verifyCancelToken(raw, hash, "secret-b"), false);
});

Deno.test("verifyCancelToken — tampered raw fails", async () => {
  const { hash } = await newCancelToken("secret");
  assertEquals(
    await verifyCancelToken("wrong-raw-token", hash, "secret"),
    false,
  );
});

Deno.test("newCancelToken — produces distinct tokens", async () => {
  const secret = "secret";
  const tokens = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const { raw } = await newCancelToken(secret);
    assertEquals(tokens.has(raw), false);
    tokens.add(raw);
  }
});

Deno.test("newCancelToken — raw is base64url", async () => {
  const { raw } = await newCancelToken("secret");
  assertEquals(/^[A-Za-z0-9_-]+$/.test(raw), true);
  assertNotEquals(raw.includes("+"), true);
  assertNotEquals(raw.includes("/"), true);
  assertNotEquals(raw.includes("="), true);
});
