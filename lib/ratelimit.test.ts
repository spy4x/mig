import { assertEquals } from "@std/assert";
import { RateLimiter } from "../lib/ratelimit.ts";

Deno.test("RateLimiter — allows up to max within window", () => {
  const r = new RateLimiter({ windowMs: 1000, max: 3 });
  assertEquals(r.check("a").ok, true);
  assertEquals(r.check("a").ok, true);
  assertEquals(r.check("a").ok, true);
  const fourth = r.check("a");
  assertEquals(fourth.ok, false);
  assertEquals(fourth.retryAfterMs > 0, true);
});

Deno.test("RateLimiter — different keys are independent", () => {
  const r = new RateLimiter({ windowMs: 1000, max: 1 });
  assertEquals(r.check("a").ok, true);
  assertEquals(r.check("a").ok, false);
  assertEquals(r.check("b").ok, true);
  assertEquals(r.check("b").ok, false);
});

Deno.test("RateLimiter — window slides", async () => {
  const r = new RateLimiter({ windowMs: 50, max: 1 });
  assertEquals(r.check("a").ok, true);
  assertEquals(r.check("a").ok, false);
  await new Promise((res) => setTimeout(res, 80));
  assertEquals(r.check("a").ok, true);
});

Deno.test("RateLimiter — retryAfterMs is within window", () => {
  const r = new RateLimiter({ windowMs: 1000, max: 1 });
  r.check("a");
  const res = r.check("a");
  assertEquals(res.ok, false);
  assertEquals(res.retryAfterMs <= 1000, true);
  assertEquals(res.retryAfterMs > 0, true);
});
