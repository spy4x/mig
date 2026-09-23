// handleBookingSubmit's redirect targets, for both base paths.
//
// The reviewer found these untested: a real fix here is a one-line
// change (swap a literal base path), and swapping it silently sends a
// standalone booking to the chrome-less /embed/confirmed page, or an
// embed booking out to the full site — exactly the bug issue #11 is
// about, just on the write path instead of the read path. Every test
// below asserts the `Location` header's pathname, not just "success".

import { assertEquals } from "@std/assert";
import nodemailer from "nodemailer";
import type { Context } from "fresh";
import type { State } from "./utils.ts";
import type { Config } from "./types.ts";
import { BookingsStore } from "./bookings.ts";
import { RateLimiter } from "./ratelimit.ts";
import { parseWeeklyAvailability } from "./availability.ts";
import { addDays, dayOfWeek, isoDateInTz } from "./tz.ts";
import { setTransportForTesting } from "./email.ts";
import { handleBookingSubmit } from "./book.ts";

// ─── Fixtures ──────────────────────────────────────────────────────

const HOST_TZ = "Europe/Berlin";

function fakeConfig(): Config {
  return {
    hostName: "Jane Doe",
    hostEmail: "jane@example.com",
    hostTz: HOST_TZ,
    meetingUrl: "https://meet.example.com/room",
    publicUrl: "https://mig.example.com",
    weeklyAvailability: parseWeeklyAvailability("MON-FRI 09:00-17:00"),
    slotDurationMin: 30,
    minNoticeHours: 6,
    bookingHorizonDays: 14,
    blockedDates: new Set<string>(),
    rateLimitPer5Min: 10,
    theme: "auto",
    smtp: {
      host: "smtp.example.com",
      port: 587,
      user: "jane@example.com",
      pass: "not-a-real-secret",
      from: "Bookings <book@example.com>",
    },
    cancelSecret: "fake-cancel-secret-only-for-tests",
    port: 8080,
    dataPath: "/tmp/mig-book-test-unused.json",
    hideBranding: false,
    githubUrl: "https://github.com/spy4x/mig",
    version: "test",
  };
}

/** A bookable weekday at least `daysAhead` days out, so it clears
 *  minNoticeHours and lands inside MON-FRI availability regardless of
 *  which day the suite runs on. */
function futureWeekday(daysAhead: number, tz: string): string {
  let d = addDays(isoDateInTz(new Date(), tz), daysAhead, tz);
  while (dayOfWeek(d, tz) === "SAT" || dayOfWeek(d, tz) === "SUN") {
    d = addDays(d, 1, tz);
  }
  return d;
}

function tmpDataPath(): string {
  return `/tmp/mig-book-test-${crypto.randomUUID()}.json`;
}

async function rm(path: string) {
  try {
    await Deno.remove(path);
  } catch {
    // ignore
  }
}

function stubContext(
  opts: {
    config: Config;
    bookings: BookingsStore;
    rateLimiter: RateLimiter;
    fields: Record<string, string>;
  },
): Context<State> {
  const body = new URLSearchParams(opts.fields);
  const req = new Request("http://localhost/book", { method: "POST", body });
  // Context is a class with private fields, so it can't be satisfied
  // structurally — handleBookingSubmit only reads ctx.req and
  // ctx.state, both present here.
  return {
    req,
    state: {
      config: opts.config,
      bookings: opts.bookings,
      rateLimiter: opts.rateLimiter,
    },
  } as unknown as Context<State>;
}

function validFields(
  date: string,
  slot: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    name: "Visitor",
    email: "visitor@example.com",
    notes: "",
    date,
    slot,
    website: "",
    ...overrides,
  };
}

function locationPath(res: Response): string {
  const loc = res.headers.get("location");
  if (!loc) throw new Error("expected a Location header");
  return new URL(loc).pathname + new URL(loc).search;
}

// Every test sends real mail through nodemailer's built-in JSON
// transport (no network I/O, resolves instantly) instead of the real
// SMTP host in fakeConfig().smtp — see lib/bookings.test.ts and
// lib/email.test.ts for the same "temp file / no real I/O" spirit,
// applied here to the network boundary lib/email.ts owns.
setTransportForTesting(nodemailer.createTransport({ jsonTransport: true }));

// ─── Success ─────────────────────────────────────────────────────────

Deno.test('handleBookingSubmit: success under "" redirects to /confirmed', async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
    fields: validFields(date, "09:00"),
  });

  const res = await handleBookingSubmit(ctx, "");
  assertEquals(res.status, 303);
  const path2 = locationPath(res);
  assertEquals(path2.startsWith("/confirmed?"), true, path2);
  assertEquals(path2.startsWith("/embed"), false, path2);
  await rm(path);
});

Deno.test('handleBookingSubmit: success under "/embed" redirects to /embed/confirmed', async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
    fields: validFields(date, "09:30"),
  });

  const res = await handleBookingSubmit(ctx, "/embed");
  assertEquals(res.status, 303);
  const path2 = locationPath(res);
  assertEquals(path2.startsWith("/embed/confirmed?"), true, path2);
  await rm(path);
});

// ─── Validation / rate-limit failure ──────────────────────────────────

Deno.test('handleBookingSubmit: failure under "" redirects to /?err=', async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
    // Empty name fails BookingSchema's min(2) — a real validation
    // failure, not a shortcut around the trust boundary.
    fields: validFields(date, "09:00", { name: "" }),
  });

  const res = await handleBookingSubmit(ctx, "");
  assertEquals(res.status, 303);
  const path2 = locationPath(res);
  assertEquals(path2.startsWith("/?err="), true, path2);
  await rm(path);
});

Deno.test('handleBookingSubmit: failure under "/embed" redirects to /embed?err=', async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
    fields: validFields(date, "09:00", { name: "" }),
  });

  const res = await handleBookingSubmit(ctx, "/embed");
  assertEquals(res.status, 303);
  const path2 = locationPath(res);
  assertEquals(path2.startsWith("/embed?err="), true, path2);
  await rm(path);
});

Deno.test("mig#15 review: a validation failure keeps slot and tz on the redirect, not just date", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
    fields: validFields(date, "09:00", {
      name: "", // fails validation
      guestTz: "America/New_York",
    }),
  });

  const res = await handleBookingSubmit(ctx, "");
  assertEquals(res.status, 303);
  const url = new URL(res.headers.get("location")!);
  // Before mig#15's review, only `date` survived a failed redirect —
  // dropping `slot` sent the visitor back to the slot grid (losing
  // their pick), and dropping `tz` sent /embed back to the
  // host-timezone fallback and another redirect round-trip.
  assertEquals(url.searchParams.get("date"), date);
  assertEquals(url.searchParams.get("slot"), "09:00");
  assertEquals(url.searchParams.get("tz"), "America/New_York");
  await rm(path);
});

Deno.test("mig#15 review: an availability failure also keeps slot and tz on the redirect", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
    // 08:00 is outside MON-FRI 09:00-17:00 — a real availability
    // failure, past the schema-validation step.
    fields: validFields(date, "08:00", {
      guestTz: "America/New_York",
    }),
  });

  const res = await handleBookingSubmit(ctx, "");
  assertEquals(res.status, 303);
  const url = new URL(res.headers.get("location")!);
  assertEquals(url.searchParams.get("date"), date);
  assertEquals(url.searchParams.get("slot"), "08:00");
  assertEquals(url.searchParams.get("tz"), "America/New_York");
  await rm(path);
});

// ─── Honeypot ──────────────────────────────────────────────────────────

Deno.test('handleBookingSubmit: honeypot under "" redirects to /confirmed', async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
    fields: validFields(date, "09:00", { website: "http://spam.example" }),
  });

  const res = await handleBookingSubmit(ctx, "");
  assertEquals(res.status, 303);
  const path2 = locationPath(res);
  assertEquals(path2.startsWith("/confirmed?id=fake"), true, path2);
  assertEquals(bookings.list().length, 0, "honeypot must not create a booking");
  await rm(path);
});

Deno.test('handleBookingSubmit: honeypot under "/embed" redirects to /embed/confirmed', async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
    fields: validFields(date, "09:00", { website: "http://spam.example" }),
  });

  const res = await handleBookingSubmit(ctx, "/embed");
  assertEquals(res.status, 303);
  const path2 = locationPath(res);
  assertEquals(path2.startsWith("/embed/confirmed?id=fake"), true, path2);
  assertEquals(bookings.list().length, 0, "honeypot must not create a booking");
  await rm(path);
});
