// handleBookingSubmit's redirect targets, for both base paths.
//
// The reviewer found these untested: a real fix here is a one-line
// change (swap a literal base path), and swapping it silently sends a
// standalone booking to the chrome-less /embed/confirmed page, or an
// embed booking out to the full site — exactly the bug issue #11 is
// about, just on the write path instead of the read path. Every test
// below asserts the `Location` header's pathname, not just "success".

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import nodemailer from "nodemailer";
import type { Context } from "fresh";
import type { State } from "./utils.ts";
import type { Config } from "./types.ts";
import { BookingsStore } from "./bookings.ts";
import { MemoryRateLimiter } from "@spy4x/platform/rate-limit/memory";
import { getSlotsForDate, parseWeeklyAvailability } from "./availability.ts";
import { addDays, dayOfWeek, isoDateInTz } from "@spy4x/time/tz";
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
    rateLimiter: MemoryRateLimiter;
    fields: Record<string, string>;
    headers?: Record<string, string>;
  },
): Context<State> {
  const body = new URLSearchParams(opts.fields);
  const req = new Request("http://localhost/book", {
    method: "POST",
    body,
    headers: opts.headers,
  });
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
function defaultTransport() {
  return nodemailer.createTransport({ jsonTransport: true });
}
setTransportForTesting(defaultTransport());

// A minimal shape of the object nodemailer's `Mailer.sendMail` passes
// to a transport plugin's `send(mail, callback)` — see
// json-transport/index.js in the nodemailer package for the same
// `mail.data.to` / `mail.message.getEnvelope()` access pattern this
// mirrors.
interface TestMail {
  data: { to?: string; subject?: string; text?: string };
  message: { getEnvelope(): unknown };
}
type TestSendCallback = (err: Error | null, info?: unknown) => void;

/** Test-only transport (mig#19): records every `to` address it is
 *  asked to send to, and resolves immediately — no artificial delay.
 *  A round-1 review found that an earlier version of this transport
 *  held a send open behind a gate the race test below never actually
 *  waited on; removed rather than fixed, since the race the test
 *  needs doesn't come from timing at all (see the comment on that
 *  test). */
function recordingTransport(sentTo: string[]) {
  return nodemailer.createTransport({
    name: "recording-test-transport",
    version: "1.0.0",
    send(mail: TestMail, callback: TestSendCallback) {
      sentTo.push(String(mail.data.to));
      callback(null, { envelope: mail.message.getEnvelope() });
    },
  });
}

/** Test-only transport (mig#19): every send fails immediately, the
 *  same way a real SMTP error reaches `lib/email.ts`'s `sendEmail`. */
function failingTransport(message: string) {
  return nodemailer.createTransport({
    name: "failing-test-transport",
    version: "1.0.0",
    send(_mail: TestMail, callback: TestSendCallback) {
      callback(new Error(message));
    },
  });
}

/** Test-only transport (mig#19 review round 1): fails only the send
 *  to `addressToFail`, records every other `to` address it succeeds
 *  on (and, if `sentSubjects` is passed, each one's subject too —
 *  round 3 needs that to tell the "New booking" email apart from the
 *  correction that follows it, both sent `to` the same owner
 *  address; `sentTexts`, mig#27, records each one's plain-text body,
 *  so a test can inspect the correction's actual wording instead of
 *  just its subject). Lets a test single out an owner-send failure
 *  from a guest-send failure without caring which one lib/email.ts
 *  happens to attempt first. */
function failingAddressTransport(
  addressToFail: string,
  sentTo: string[],
  sentSubjects?: string[],
  sentTexts?: string[],
) {
  return nodemailer.createTransport({
    name: "failing-address-test-transport",
    version: "1.0.0",
    send(mail: TestMail, callback: TestSendCallback) {
      const to = String(mail.data.to);
      if (to === addressToFail) {
        callback(new Error(`simulated SMTP failure for ${to}`));
        return;
      }
      sentTo.push(to);
      sentSubjects?.push(String(mail.data.subject ?? ""));
      sentTexts?.push(String(mail.data.text ?? ""));
      callback(null, { envelope: mail.message.getEnvelope() });
    },
  });
}

/** Test-only transport (mig#19 review round 3): the very first send
 *  fails; every send after that succeeds and is recorded (`to` and
 *  subject). Simulates the owner's own send failing in a way that
 *  would still reveal a wrongly-sent correction afterward —
 *  `failingAddressTransport(cfg.hostEmail, ...)` can't do that, since
 *  it rejects every send to the owner's address, including a
 *  correction that also targets it, so a bug that skipped the
 *  `ownerEmailSucceeded` guard would still show up as "nothing sent"
 *  there. */
function failFirstSendTransport(sentTo: string[], sentSubjects: string[]) {
  let calls = 0;
  return nodemailer.createTransport({
    name: "fail-first-send-test-transport",
    version: "1.0.0",
    send(mail: TestMail, callback: TestSendCallback) {
      calls++;
      if (calls === 1) {
        callback(new Error("simulated SMTP failure for the first send"));
        return;
      }
      sentTo.push(String(mail.data.to));
      sentSubjects.push(String(mail.data.subject ?? ""));
      callback(null, { envelope: mail.message.getEnvelope() });
    },
  });
}

/** Test-only (mig#19 review round 1): makes `store`'s very next
 *  persist() call reject once, then delegates to the real
 *  implementation for every call after that — simulating the disk
 *  write failing on exactly one save. `persist` is a TypeScript
 *  `private` method only at compile time; the modifier is erased at
 *  runtime, so this overrides the instance's own copy, which a
 *  `this.persist()` call inside `BookingsStore.mutate()` finds before
 *  the class's prototype method. Call this *after* `store.init()`, so
 *  the real write `init()` does for a missing file isn't the call
 *  that fails. */
function makePersistFailOnce(store: BookingsStore, message: string): void {
  const anyStore = store as unknown as { persist: () => Promise<void> };
  const realPersist: () => Promise<void> = anyStore.persist.bind(store);
  let failed = false;
  anyStore.persist = async () => {
    if (!failed) {
      failed = true;
      throw new Error(message);
    }
    await realPersist();
  };
}

/** Test-only: like `makePersistFailOnce`, but fails only the `callToFail`th
 *  `persist()` call (1-indexed, counting from calls made after this is
 *  installed) and delegates every other call to the real implementation.
 *  Used to let Phase 1's initial save succeed while the rollback's own
 *  disk write — the next `persist()` call after an email-send failure —
 *  fails. Call this *after* `store.init()`, same reason as
 *  `makePersistFailOnce`. */
function makePersistFailOnCall(
  store: BookingsStore,
  callToFail: number,
  message: string,
): void {
  const anyStore = store as unknown as { persist: () => Promise<void> };
  const realPersist: () => Promise<void> = anyStore.persist.bind(store);
  let calls = 0;
  anyStore.persist = async () => {
    calls++;
    if (calls === callToFail) {
      throw new Error(message);
    }
    await realPersist();
  };
}

/** Captures every `console.error` call made while `fn` runs, then
 *  restores the real one — even if `fn` throws. */
async function captureConsoleError(
  fn: () => Promise<void>,
): Promise<unknown[][]> {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return calls;
}

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
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
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
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
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
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
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
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
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
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
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

// ─── mig#44: theme survives every redirect ────────────────────────────

Deno.test("mig#44: a successful embed booking keeps the forced theme on the redirect", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
    fields: validFields(date, "09:00", { theme: "dark" }),
  });

  const res = await handleBookingSubmit(ctx, "/embed");
  assertEquals(res.status, 303);
  const url = new URL(res.headers.get("location")!);
  assertEquals(url.pathname, "/embed/confirmed");
  assertEquals(url.searchParams.get("theme"), "dark");
  await rm(path);
});

Deno.test("mig#44: a validation failure keeps the forced theme on the redirect", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
    fields: validFields(date, "09:00", { name: "", theme: "light" }),
  });

  const res = await handleBookingSubmit(ctx, "/embed");
  assertEquals(res.status, 303);
  const url = new URL(res.headers.get("location")!);
  assertEquals(url.searchParams.get("theme"), "light");
  await rm(path);
});

Deno.test("mig#44: a rate-limited redirect keeps the forced theme", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  // limit: 1 — same setup as "a rate-limited redirect keeps date and
  // tz" above: the first submission consumes the only slot in the
  // window, so the second one is the one that gets rate-limited.
  const rateLimiter = new MemoryRateLimiter({ windowMs: 300_000, limit: 1 });
  const fields = validFields(date, "09:00", { theme: "dark" });

  const first = await handleBookingSubmit(
    stubContext({ config: cfg, bookings, rateLimiter, fields }),
    "/embed",
  );
  assertEquals(first.status, 303);

  const second = await handleBookingSubmit(
    stubContext({ config: cfg, bookings, rateLimiter, fields }),
    "/embed",
  );
  assertEquals(second.status, 303);
  const url = new URL(second.headers.get("location")!);
  assertEquals(url.searchParams.get("theme"), "dark");
  await rm(path);
});

Deno.test("mig#44: honeypot redirect keeps the forced theme", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
    fields: validFields(date, "09:00", {
      website: "http://spam.example",
      theme: "dark",
    }),
  });

  const res = await handleBookingSubmit(ctx, "/embed");
  assertEquals(res.status, 303);
  const url = new URL(res.headers.get("location")!);
  assertEquals(url.searchParams.get("theme"), "dark");
  await rm(path);
});

Deno.test("mig#44: no theme field on the form means no theme param on the redirect (standalone)", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
    fields: validFields(date, "09:00"),
  });

  const res = await handleBookingSubmit(ctx, "");
  assertEquals(res.status, 303);
  const url = new URL(res.headers.get("location")!);
  assertEquals(url.searchParams.has("theme"), false);
  await rm(path);
});

Deno.test("mig#44: a slot-taken conflict keeps the forced theme on the redirect", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  // Same setup as "a slot-taken conflict drops slot from the redirect"
  // above: pre-populate the exact slot so Phase 1's conflict check is
  // the one that fires.
  await bookings.mutate((draft) => {
    draft.push({
      id: "01EXISTING",
      createdAt: new Date().toISOString(),
      date,
      time: "09:00",
      hostTz: HOST_TZ,
      guestName: "Someone Else",
      guestEmail: "else@example.com",
      cancelTokenHash: "h",
      status: "active",
    });
  });
  try {
    const ctx = stubContext({
      config: cfg,
      bookings,
      rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
      fields: validFields(date, "09:00", { theme: "dark" }),
    });

    const res = await handleBookingSubmit(ctx, "/embed");
    assertEquals(res.status, 303);
    const url = new URL(res.headers.get("location")!);
    assertEquals(url.searchParams.get("theme"), "dark");
  } finally {
    await rm(path);
  }
});

Deno.test("mig#44: an email-send failure keeps the forced theme on the rollback redirect", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  setTransportForTesting(failingTransport("SMTP send failed (mig#44 test)"));

  try {
    const ctx = stubContext({
      config: cfg,
      bookings,
      rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
      fields: validFields(date, "09:00", { theme: "light" }),
    });

    const res = await handleBookingSubmit(ctx, "/embed");
    assertEquals(res.status, 303);
    const url = new URL(res.headers.get("location")!);
    assertEquals(url.searchParams.get("theme"), "light");
  } finally {
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

Deno.test("mig#44: a minimum-notice failure ('That time is no longer available.') keeps the forced theme on the redirect", async () => {
  // Triggers lib/book.ts's `slotInstant < minStart` branch specifically
  // — not the conflict, availability, or blocked-date checks below it
  // — by setting minNoticeHours far longer than how far ahead the
  // picked date actually is (3 days). date/slot themselves are still
  // schema-valid and within MON-FRI 09:00-17:00, so this is the first
  // and only check that fails.
  const cfg = { ...fakeConfig(), minNoticeHours: 24 * 10 };
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
    fields: validFields(date, "09:00", { theme: "dark" }),
  });

  const res = await handleBookingSubmit(ctx, "/embed");
  assertEquals(res.status, 303);
  const url = new URL(res.headers.get("location")!);
  assertEquals(
    url.searchParams.get("err"),
    "That time is no longer available.",
  );
  assertEquals(url.searchParams.get("theme"), "dark");
  await rm(path);
});

Deno.test("an availability failure drops slot but keeps date and tz on the redirect", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
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
  // mig#15 round 2: 08:00 was never a bookable slot at all — keeping
  // it on the redirect would land the visitor on the confirm step for
  // a slot that was never valid to begin with.
  assertEquals(url.searchParams.get("slot"), null);
  assertEquals(url.searchParams.get("tz"), "America/New_York");
  await rm(path);
});

Deno.test("a slot-taken conflict drops slot from the redirect (keeps date and tz)", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  // Pre-populate the exact slot this submission will target, so
  // Phase 1's conflict check (mig#19: save-then-send, so this is the
  // very first thing that runs after the input validates) is the one
  // that fires — not the schema or availability checks.
  await bookings.mutate((draft) => {
    draft.push({
      id: "01EXISTING",
      createdAt: new Date().toISOString(),
      date,
      time: "09:00",
      hostTz: HOST_TZ,
      guestName: "Someone Else",
      guestEmail: "else@example.com",
      cancelTokenHash: "h",
      status: "active",
    });
  });
  try {
    const ctx = stubContext({
      config: cfg,
      bookings,
      rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
      fields: validFields(date, "09:00", { guestTz: "America/New_York" }),
    });

    const res = await handleBookingSubmit(ctx, "");
    assertEquals(res.status, 303);
    const url = new URL(res.headers.get("location")!);
    // A gone slot must not come back on the redirect — landing on the
    // confirm step for it would let the visitor resubmit and trigger a
    // second, false confirmation email pair (mig#15 round 2).
    assertEquals(url.searchParams.get("slot"), null);
    assertEquals(url.searchParams.get("date"), date);
    assertEquals(url.searchParams.get("tz"), "America/New_York");
    // mig#19 review round 1: the old message ("The confirmation email
    // you received is no longer valid") only made sense when Phase 1
    // sent mail before checking for a conflict. Nothing is ever sent
    // to the loser now, so the message must not claim otherwise.
    const err = (url.searchParams.get("err") ?? "").toLowerCase();
    assertEquals(err.includes("email"), false, err);
  } finally {
    // try/finally (mig#19 review round 3): a red assertion above must
    // not skip this and leave /tmp/mig-book-test-*.json behind.
    await rm(path);
  }
});

// ─── Rate limit ────────────────────────────────────────────────────────

Deno.test("a rate-limited redirect keeps date and tz", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  // limit: 1 — the first submission consumes the only slot in the
  // window, so the second one below is the one that gets rate-limited.
  const rateLimiter = new MemoryRateLimiter({ windowMs: 300_000, limit: 1 });
  const fields = validFields(date, "09:00", { guestTz: "America/New_York" });

  const first = await handleBookingSubmit(
    stubContext({ config: cfg, bookings, rateLimiter, fields }),
    "",
  );
  assertEquals(first.status, 303);

  const second = await handleBookingSubmit(
    stubContext({ config: cfg, bookings, rateLimiter, fields }),
    "",
  );
  assertEquals(second.status, 303);
  const url = new URL(second.headers.get("location")!);
  // Before this fix, a rate-limited redirect carried no `date` and no
  // `tz`, sending the visitor back to the date picker from scratch.
  assertEquals(url.searchParams.get("date"), date);
  assertEquals(url.searchParams.get("tz"), "America/New_York");
  // Unlike the other failure redirects, `slot` never rides along here
  // — a rate-limited request never got far enough to confirm the slot
  // is still free.
  assertEquals(url.searchParams.get("slot"), null);
  await rm(path);
});

Deno.test("a rate-limited redirect caps an oversized date or tz instead of carrying it whole", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  // limit: 1 — the first submission consumes the only slot in the
  // window, same as the test above, so the second one is the one
  // that's rate-limited and hits the cap.
  const rateLimiter = new MemoryRateLimiter({ windowMs: 300_000, limit: 1 });
  const first = await handleBookingSubmit(
    stubContext({
      config: cfg,
      bookings,
      rateLimiter,
      fields: validFields(date, "09:00", { guestTz: "America/New_York" }),
    }),
    "",
  );
  assertEquals(first.status, 303);

  const hugeDate = "2".repeat(200_000);
  const hugeTz = "America/New_York".repeat(20_000);
  const fields = validFields(hugeDate, "09:00", { guestTz: hugeTz });

  const res = await handleBookingSubmit(
    stubContext({ config: cfg, bookings, rateLimiter, fields }),
    "",
  );
  assertEquals(res.status, 303);
  const loc = res.headers.get("location")!;
  // Short: capped at 100 chars per field, not the 200,000 sent in.
  // (Well under 1000 — a generous margin above "two 100-char fields
  // plus a handful of literal query-string characters".)
  assertEquals(
    loc.length < 1000,
    true,
    `Location header too long: ${loc.length}`,
  );
  assertEquals(loc.startsWith(cfg.publicUrl), true, loc);
  const url = new URL(loc);
  assertEquals(url.searchParams.get("date")?.length, 100);
  assertEquals(url.searchParams.get("tz")?.length, 100);
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
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
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
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
    fields: validFields(date, "09:00", { website: "http://spam.example" }),
  });

  const res = await handleBookingSubmit(ctx, "/embed");
  assertEquals(res.status, 303);
  const path2 = locationPath(res);
  assertEquals(path2.startsWith("/embed/confirmed?id=fake"), true, path2);
  assertEquals(bookings.list().length, 0, "honeypot must not create a booking");
  await rm(path);
});

// ─── mig#18: uncapped `slot` on a validation-failure redirect ────────

Deno.test("a validation-failure redirect caps an oversized slot, like date and tz", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const hugeSlot = "9".repeat(200_000);

  try {
    const ctx = stubContext({
      config: cfg,
      bookings,
      rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
      // An invalid email fails BookingSchema, landing on the
      // `redirectState` branch that carries `slot` along — the one
      // mig#18's reviewer found left uncapped.
      fields: validFields(date, hugeSlot, { email: "not-an-email" }),
    });

    const res = await handleBookingSubmit(ctx, "");
    assertEquals(res.status, 303);
    const loc = res.headers.get("location")!;
    assertEquals(loc.startsWith(cfg.publicUrl), true, loc);
    const url = new URL(loc);
    assertEquals(url.searchParams.get("slot")?.length, 100);
  } finally {
    // try/finally (mig#19 review round 1): a red assertion above must
    // not skip this and leave /tmp/mig-book-test-*.json behind.
    await rm(path);
  }
});

// ─── mig#19: a lost race must send no email for a booking never saved ──

Deno.test("mig#19: the loser of a slot race sends no email and stores no booking", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const rateLimiter = new MemoryRateLimiter({ windowMs: 300_000, limit: 10 });

  const sentTo: string[] = [];
  setTransportForTesting(recordingTransport(sentTo));

  try {
    const fieldsAlice = validFields(date, "09:00", {
      name: "Alice",
      email: "alice@example.com",
      guestTz: "America/New_York",
    });
    const fieldsBob = validFields(date, "09:00", {
      name: "Bob",
      email: "bob@example.com",
      guestTz: "America/New_York",
    });

    // What actually makes these two race (mig#19 review round 1): an
    // earlier version of this test held the winner's email send open
    // behind a gate, on the theory that the delay was needed for the
    // two requests to overlap. It wasn't — the gate was released
    // before either promise below had even reached the transport, and
    // removing it changes nothing. The real overlap comes from how
    // these two calls are made: `handleBookingSubmit(alice)` and
    // `handleBookingSubmit(bob)` are both invoked here with neither
    // awaited first, so both run synchronously up to their own first
    // `await` (`ctx.req.formData()`) before either suspends — by the
    // time this function itself next awaits anything, both are
    // already pending. From there the two interleave through the
    // identical sequence of checks ahead of them, and
    // `BookingsStore.mutate()`'s `AsyncMutex` is what actually
    // decides the race: whichever call reaches `mutate()` first gets
    // the slot, and the loser's own `mutate()` doesn't resolve until
    // the winner's persist() has already completed, so the conflict
    // it sees is never stale. None of that depends on wall-clock
    // timing, which is why no gate or sleep is needed to make it
    // deterministic: reverting lib/book.ts to send-then-save turns
    // this test red without any change here.
    const alicePromise = handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter,
        fields: fieldsAlice,
      }),
      "",
    );
    const bobPromise = handleBookingSubmit(
      stubContext({ config: cfg, bookings, rateLimiter, fields: fieldsBob }),
      "",
    );

    const [aliceRes, bobRes] = await Promise.all([alicePromise, bobPromise]);
    const named = [{ who: "alice", res: aliceRes }, {
      who: "bob",
      res: bobRes,
    }];
    const winner = named.find((r) =>
      locationPath(r.res).startsWith("/confirmed?")
    );
    const loser = named.find((r) => r !== winner);
    if (!winner || !loser) {
      throw new Error(
        "expected exactly one winner and one loser; got " +
          `alice=${locationPath(aliceRes)} bob=${locationPath(bobRes)}`,
      );
    }

    // The loser lands back on the slot list: no `slot`, `date` and
    // `tz` kept, same as every other conflict redirect.
    assertEquals(loser.res.status, 303);
    const loserUrl = new URL(loser.res.headers.get("location")!);
    assertEquals(loserUrl.pathname, "/");
    assertEquals(loserUrl.searchParams.get("slot"), null);
    assertEquals(loserUrl.searchParams.get("date"), date);
    assertEquals(loserUrl.searchParams.get("tz"), "America/New_York");

    // Exactly one booking stored for the slot.
    const stored = bookings.list().filter((b) =>
      b.date === date && b.time === "09:00" && b.status === "active"
    );
    assertEquals(
      stored.length,
      1,
      `stored bookings: ${JSON.stringify(stored)}`,
    );

    // Exactly one guest email and exactly one owner email sent, total
    // — the loser's request never reaches Phase 2 at all, so nothing
    // for it was ever handed to the transport.
    const ownerEmails = sentTo.filter((to) => to === cfg.hostEmail);
    const guestEmails = sentTo.filter((to) => to !== cfg.hostEmail);
    assertEquals(ownerEmails.length, 1, `sent: ${sentTo}`);
    assertEquals(guestEmails.length, 1, `sent: ${sentTo}`);
    assertEquals(sentTo.length, 2, `sent: ${sentTo}`);

    // The slot list for that date shows the slot as unavailable — the
    // same booked-time computation routes/index.tsx inlines to render
    // the picker (booked = the active bookings' times for the date).
    const minStart = new Date(Date.now() + cfg.minNoticeHours * 3600_000);
    const daySlots = getSlotsForDate(
      date,
      cfg.weeklyAvailability,
      cfg.slotDurationMin,
      bookings.forDate(date),
      cfg.hostTz,
      minStart,
    );
    assertEquals(daySlots.find((s) => s.time === "09:00")?.available, false);
  } finally {
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

// ─── mig#19: a failed send after a save must roll the save back ────────

Deno.test("mig#19: a failed send after a save rolls the booking back and says so", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  setTransportForTesting(failingTransport("SMTP send failed (mig#19 test)"));

  try {
    const ctx = stubContext({
      config: cfg,
      bookings,
      rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
      fields: validFields(date, "09:00"),
    });

    const res = await handleBookingSubmit(ctx, "");
    assertEquals(res.status, 303);
    const url = new URL(res.headers.get("location")!);
    assertStringIncludes(
      url.searchParams.get("err") ?? "",
      "the booking was not created",
    );
    // The slot is free again: the save from Phase 1 was undone, not
    // left behind with no confirmation and no working cancel link.
    assertEquals(
      bookings.list().filter((b) => b.date === date && b.time === "09:00")
        .length,
      0,
      "the rolled-back booking must not remain in the store",
    );
    // `slot` rides along on this redirect — the slot is free again,
    // so retrying it is meaningful (unlike a real conflict).
    assertEquals(url.searchParams.get("slot"), "09:00");
  } finally {
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

// review follow-up: the redirect message used to say "we couldn't send
// your confirmation email", which names the visitor's own email even
// when it's the *owner's* send that failed and the guest's never ran.
// Both failure modes must read identically — the visitor has no way
// to know which recipient's send actually failed.
Deno.test("a failed owner send and a failed guest send redirect with the same neutral message", async () => {
  const cfg = fakeConfig();
  const rateLimiter = new MemoryRateLimiter({ windowMs: 300_000, limit: 10 });
  const neutralMessage =
    "Something went wrong, so the booking was not created. Please try again in a moment.";

  const ownerFailsPath = tmpDataPath();
  const ownerFailsStore = new BookingsStore({ filePath: ownerFailsPath });
  await ownerFailsStore.init();
  const guestFailsPath = tmpDataPath();
  const guestFailsStore = new BookingsStore({ filePath: guestFailsPath });
  await guestFailsStore.init();

  try {
    setTransportForTesting(
      failingTransport("simulated SMTP failure (owner send)"),
    );
    const ownerFailsDate = futureWeekday(3, HOST_TZ);
    const ownerFailsRes = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings: ownerFailsStore,
        rateLimiter,
        fields: validFields(ownerFailsDate, "09:00"),
      }),
      "",
    );
    assertEquals(
      new URL(ownerFailsRes.headers.get("location")!).searchParams.get(
        "err",
      ),
      neutralMessage,
    );

    setTransportForTesting(
      failingAddressTransport("visitor@example.com", []),
    );
    const guestFailsDate = futureWeekday(4, HOST_TZ);
    const guestFailsRes = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings: guestFailsStore,
        rateLimiter,
        fields: validFields(guestFailsDate, "09:00"),
      }),
      "",
    );
    assertEquals(
      new URL(guestFailsRes.headers.get("location")!).searchParams.get(
        "err",
      ),
      neutralMessage,
    );
  } finally {
    setTransportForTesting(defaultTransport());
    await rm(ownerFailsPath);
    await rm(guestFailsPath);
  }
});

// ─── mig#19 review round 1: a failed initial save must roll itself back ──

Deno.test("mig#19: a persist failure on the initial save leaves nothing behind and lets a retry through", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  makePersistFailOnce(
    bookings,
    "simulated disk write failure (mig#19 test)",
  );
  const date = futureWeekday(3, HOST_TZ);
  const rateLimiter = new MemoryRateLimiter({ windowMs: 300_000, limit: 10 });
  const sentTo: string[] = [];
  setTransportForTesting(recordingTransport(sentTo));

  try {
    const fields = validFields(date, "09:00");

    // First attempt: the store's very next persist() call — Phase 1's
    // save — throws, the same way a real disk write can fail.
    const firstRes = await handleBookingSubmit(
      stubContext({ config: cfg, bookings, rateLimiter, fields }),
      "",
    );
    assertEquals(firstRes.status, 303);
    const firstUrl = new URL(firstRes.headers.get("location")!);
    // mig#19 review round 1: the old message ("Your confirmation was
    // sent, but we couldn't save the booking") only made sense when
    // Phase 1 sent mail before persisting. Nothing is sent before the
    // save succeeds now, so the message must not claim a confirmation
    // went out.
    const err = (firstUrl.searchParams.get("err") ?? "").toLowerCase();
    assertEquals(err.includes("sent"), false, err);

    // Nothing was left behind in memory. BookingsStore.mutate()
    // assigns `this.bookings = draft` *before* it awaits persist()
    // (lib/bookings.ts), so without the rollback this test guards,
    // the booking pushed by the failed save would still be sitting in
    // the in-memory array — the slot would show as booked, and the
    // retry below would be told it was "just booked by someone else"
    // instead of succeeding.
    assertEquals(
      bookings.list().filter((b) => b.date === date && b.time === "09:00")
        .length,
      0,
      "a booking must not survive a failed initial save",
    );
    // Nothing was ever sent — the failure happened before Phase 2 even
    // built a cancel URL.
    assertEquals(sentTo.length, 0, `sent: ${sentTo}`);

    // Retry the same slot: makePersistFailOnce only fails the first
    // call, so this attempt's persist() behaves normally and must
    // succeed outright.
    const secondRes = await handleBookingSubmit(
      stubContext({ config: cfg, bookings, rateLimiter, fields }),
      "",
    );
    assertEquals(secondRes.status, 303);
    assertEquals(
      locationPath(secondRes).startsWith("/confirmed?"),
      true,
      locationPath(secondRes),
    );
    assertEquals(
      bookings.list().filter((b) =>
        b.date === date && b.time === "09:00" && b.status === "active"
      ).length,
      1,
      "the retry must have saved exactly one booking",
    );
  } finally {
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

// ─── review follow-up: the rollback-failure log must say whether the owner email went out ──

Deno.test("rollback-failure log says the owner email was sent when the guest send is what failed", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  // Phase 1's own save (persist call #1) succeeds for real; only the
  // rollback write that follows the email failure (call #2) fails.
  makePersistFailOnCall(
    bookings,
    2,
    "simulated disk write failure (rollback)",
  );
  const date = futureWeekday(3, HOST_TZ);
  // Owner (jane@example.com) sends fine; the guest send is what fails
  // — so ownerEmailSucceeded is true by the time the rollback runs.
  setTransportForTesting(failingAddressTransport("visitor@example.com", []));

  try {
    const logs = await captureConsoleError(async () => {
      const ctx = stubContext({
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
        fields: validFields(date, "09:00"),
      });
      await handleBookingSubmit(ctx, "");
    });
    const rollbackLog = logs.find((args) =>
      typeof args[0] === "string" &&
      args[0].includes("rollback FAILED after email send failed")
    );
    assert(
      rollbackLog,
      `expected a rollback-failure log, got: ${JSON.stringify(logs)}`,
    );
    assertStringIncludes(String(rollbackLog![0]), "owner email was sent");
  } finally {
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

Deno.test("rollback-failure log says the owner email was not sent when the owner send itself failed", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  makePersistFailOnCall(
    bookings,
    2,
    "simulated disk write failure (rollback)",
  );
  const date = futureWeekday(3, HOST_TZ);
  // Every send fails, starting with the owner's own — so
  // ownerEmailSucceeded is still false when the rollback runs.
  setTransportForTesting(
    failingTransport("simulated SMTP failure (owner send)"),
  );

  try {
    const logs = await captureConsoleError(async () => {
      const ctx = stubContext({
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
        fields: validFields(date, "09:00"),
      });
      await handleBookingSubmit(ctx, "");
    });
    const rollbackLog = logs.find((args) =>
      typeof args[0] === "string" &&
      args[0].includes("rollback FAILED after email send failed")
    );
    assert(
      rollbackLog,
      `expected a rollback-failure log, got: ${JSON.stringify(logs)}`,
    );
    assertStringIncludes(String(rollbackLog![0]), "owner email was not sent");
  } finally {
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

// ─── mig#19 review round 1: owner email goes out first, then guest ──────

Deno.test("mig#19: a guest-send failure corrects the owner after rolling back", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const sentTo: string[] = [];
  const sentSubjects: string[] = [];
  const sentTexts: string[] = [];
  // validFields()'s default guest address.
  const guestEmail = "visitor@example.com";
  setTransportForTesting(
    failingAddressTransport(guestEmail, sentTo, sentSubjects, sentTexts),
  );

  try {
    const res = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
        fields: validFields(date, "09:00"),
      }),
      "",
    );
    assertEquals(res.status, 303);
    // mig#19 review round 3: the owner gets exactly two emails — the
    // "New booking" one (which is why a correction is owed at all),
    // then the correction, both `to` the owner since the guest's send
    // never succeeds here. The guest gets neither.
    assertEquals(sentTo, [cfg.hostEmail, cfg.hostEmail], `sent: ${sentTo}`);
    assertEquals(sentSubjects.length, 2, `subjects: ${sentSubjects}`);
    assertStringIncludes(sentSubjects[0], "New booking");
    // "or similar" per the review: this pins the correction subject's
    // intent, not its exact copy — see sendBookingCorrectionEmail in
    // lib/email.ts for the literal text.
    assertEquals(
      /not.*(booked|created)/i.test(sentSubjects[1]),
      true,
      `correction subject: ${sentSubjects[1]}`,
    );
    // The rollback here succeeds (no persist failure injected), so the
    // correction must use the "removed, slot free again" wording, not
    // the rollback-failed one.
    assertStringIncludes(sentTexts[1], "the slot is free again");
    assertEquals(
      sentSubjects[1].includes("remove by hand"),
      false,
      `correction subject: ${sentSubjects[1]}`,
    );
    assertStringIncludes(
      new URL(res.headers.get("location")!).searchParams.get("err") ?? "",
      "the booking was not created",
    );
    assertEquals(
      bookings.list().filter((b) => b.date === date && b.time === "09:00")
        .length,
      0,
      "the rolled-back booking must not remain in the store",
    );
  } finally {
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

Deno.test("mig#19: an owner-send failure reaches nobody, sends no correction", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const sentTo: string[] = [];
  const sentSubjects: string[] = [];
  // failFirstSendTransport, not failingAddressTransport: a correction
  // that were wrongly sent despite the owner send failing would also
  // target the owner's address, so a transport that always rejects
  // that address couldn't tell "no correction attempted" apart from
  // "a correction was attempted and also rejected". Failing only the
  // first call can.
  setTransportForTesting(failFirstSendTransport(sentTo, sentSubjects));

  try {
    const res = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
        fields: validFields(date, "09:00"),
      }),
      "",
    );
    assertEquals(res.status, 303);
    // lib/book.ts awaits sendOwnerBookingEmail first and throws
    // straight out of that await on failure, so neither the guest
    // send nor (since `ownerEmailSucceeded` never got set) the
    // correction ever runs. Swap lib/book.ts's two `await
    // send*BookingEmail` calls and this goes red: the guest send
    // would succeed (as the second call) before the owner one failed.
    assertEquals(sentTo, [], `sent: ${sentTo}`);
    assertEquals(sentSubjects, [], `subjects: ${sentSubjects}`);
    assertEquals(
      bookings.list().filter((b) => b.date === date && b.time === "09:00")
        .length,
      0,
      "the rolled-back booking must not remain in the store",
    );
  } finally {
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

// ─── mig#19 review round 3: the NTFY push must be true ──────────────

Deno.test("mig#19: a failed send pushes an NTFY notice that says the booking was not created", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  setTransportForTesting(failingTransport("SMTP send failed (mig#19 test)"));

  // Same "stub fetch, set NTFY_* env vars" pattern as
  // lib/notify.test.ts's captureNtfyBody, inlined here because this
  // test needs it wrapped around a full handleBookingSubmit call
  // (to catch a deleted notifyBookingEmailFailed call site in
  // lib/book.ts), not a direct call into lib/notify.ts.
  const originalFetch = globalThis.fetch;
  let pushCalled = false;
  let pushBody = "";
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    pushCalled = true;
    pushBody = String(init?.body ?? "");
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  Deno.env.set("NTFY_URL", "https://ntfy.example.com");
  Deno.env.set("NTFY_TOPIC", "mig-test");
  Deno.env.set("NTFY_TOKEN", "test-token");

  try {
    const res = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
        fields: validFields(date, "09:00"),
      }),
      "",
    );
    assertEquals(res.status, 303);
    assertEquals(pushCalled, true, "expected an NTFY push");
    // mig#19 review round 3: the push must say the booking was not
    // created, not only that an email "failed to send" — a host
    // skimming a phone notification could read the old wording as "an
    // email is late" rather than "there is no booking".
    assertStringIncludes(pushBody.toLowerCase(), "not created");
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("NTFY_URL");
    Deno.env.delete("NTFY_TOPIC");
    Deno.env.delete("NTFY_TOKEN");
    Deno.env.delete("NTFY_MODE");
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

// ─── the NTFY push must reflect the rollback's own outcome ─────────────

Deno.test("handleBookingSubmit: a guest-send failure with a working store pushes an NTFY notice saying the booking was removed and the slot is free", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const sentTo: string[] = [];
  // validFields()'s default guest address — failingAddressTransport
  // fails only that one, so the owner send (attempted first in
  // lib/book.ts) actually succeeds and the guest send is the one that
  // fails, the same shape as a real guest-send failure. failingTransport
  // fails every send, which would fail the owner's send instead — not
  // what this test claims to exercise.
  setTransportForTesting(
    failingAddressTransport("visitor@example.com", sentTo),
  );

  const originalFetch = globalThis.fetch;
  let pushBody = "";
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    pushBody = String(init?.body ?? "");
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  Deno.env.set("NTFY_URL", "https://ntfy.example.com");
  Deno.env.set("NTFY_TOPIC", "mig-test");
  Deno.env.set("NTFY_TOKEN", "test-token");

  try {
    const res = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
        fields: validFields(date, "09:00"),
      }),
      "",
    );
    assertEquals(res.status, 303);
    // The owner gets two emails — "New booking", then the correction
    // lib/book.ts sends once it knows the booking was rolled back
    // (mig#19 review round 3) — both `to` the owner, since the guest
    // send is the one that failed here.
    assertEquals(
      sentTo,
      [cfg.hostEmail, cfg.hostEmail],
      `the owner must have gotten "New booking" then the correction: ${sentTo}`,
    );
    const lower = pushBody.toLowerCase();
    assertStringIncludes(lower, "removed");
    assertStringIncludes(lower, "free");
    assertEquals(
      bookings.list().filter((b) => b.date === date && b.time === "09:00")
        .length,
      0,
      "the rolled-back booking must not remain in the store",
    );
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("NTFY_URL");
    Deno.env.delete("NTFY_TOPIC");
    Deno.env.delete("NTFY_TOKEN");
    Deno.env.delete("NTFY_MODE");
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

Deno.test("handleBookingSubmit: a guest-send failure where the rollback write also fails pushes an NTFY notice that does not claim the booking was removed", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  // Call 1 is Phase 1's initial save (must succeed); call 2 is the
  // rollback's own write, triggered by the email-send failure below.
  makePersistFailOnCall(bookings, 2, "simulated disk write failure");
  const date = futureWeekday(3, HOST_TZ);
  const sentTo: string[] = [];
  // Fails only the guest address, same reasoning as the test above:
  // the owner send must actually succeed so the guest send is the one
  // that fails and triggers the rollback this test is about.
  setTransportForTesting(
    failingAddressTransport("visitor@example.com", sentTo),
  );

  const originalFetch = globalThis.fetch;
  let pushBody = "";
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    pushBody = String(init?.body ?? "");
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  Deno.env.set("NTFY_URL", "https://ntfy.example.com");
  Deno.env.set("NTFY_TOPIC", "mig-test");
  Deno.env.set("NTFY_TOKEN", "test-token");

  try {
    const res = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
        fields: validFields(date, "09:00"),
      }),
      "",
    );
    assertEquals(res.status, 303);
    // Same "New booking" + correction shape as the test above — the
    // rollback's own write failing doesn't change whether the owner
    // send succeeded, only whether the rollback did.
    assertEquals(
      sentTo,
      [cfg.hostEmail, cfg.hostEmail],
      `the owner must have gotten "New booking" then the correction: ${sentTo}`,
    );
    const lower = pushBody.toLowerCase();
    assertEquals(
      lower.includes("removed"),
      false,
      `push must not claim removal when the rollback write failed: ${pushBody}`,
    );
    assertEquals(
      lower.includes("free"),
      false,
      `push must not claim the slot is free when the rollback write failed: ${pushBody}`,
    );
    assertStringIncludes(lower, "may still be on disk");
    // The in-memory copy is gone regardless — BookingsStore.mutate()
    // assigns before it awaits persist() (lib/bookings.ts) — but the
    // on-disk file still has it, since the rollback's own write threw.
    assertEquals(
      bookings.list().filter((b) => b.date === date && b.time === "09:00")
        .length,
      0,
      "the in-memory copy is removed even though the rollback write failed",
    );
    const onDisk = JSON.parse(await Deno.readTextFile(path));
    assertEquals(
      onDisk.some((b: { date: string; time: string }) =>
        b.date === date && b.time === "09:00"
      ),
      true,
      `on-disk file must still hold the booking the rollback failed to remove: ${
        JSON.stringify(onDisk)
      }`,
    );
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("NTFY_URL");
    Deno.env.delete("NTFY_TOPIC");
    Deno.env.delete("NTFY_TOKEN");
    Deno.env.delete("NTFY_MODE");
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

// mig#27: the correction email had the same bug the NTFY push above
// was fixed for (mig#19 review round 3) — it always claimed the
// booking "was removed and the slot is free again", even when the
// rollback's own disk write also failed. Same setup as the NTFY test
// above (guest-send failure, rollback write fails on the second
// persist() call), but reading the correction email's own body
// instead of the push.
Deno.test("mig#27: the correction email does not claim removal when the rollback write also fails", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  makePersistFailOnCall(bookings, 2, "simulated disk write failure");
  const date = futureWeekday(3, HOST_TZ);
  const sentTo: string[] = [];
  const sentSubjects: string[] = [];
  const sentTexts: string[] = [];
  setTransportForTesting(
    failingAddressTransport(
      "visitor@example.com",
      sentTo,
      sentSubjects,
      sentTexts,
    ),
  );

  try {
    const res = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
        fields: validFields(date, "09:00"),
      }),
      "",
    );
    assertEquals(res.status, 303);
    // Same "New booking" + correction shape as the NTFY tests above.
    assertEquals(
      sentTo,
      [cfg.hostEmail, cfg.hostEmail],
      `the owner must have gotten "New booking" then the correction: ${sentTo}`,
    );
    const correctionText = sentTexts[1] ?? "";
    assertEquals(
      /not.*(booked|created)/i.test(sentSubjects[1] ?? ""),
      true,
      `correction subject: ${sentSubjects[1]}`,
    );
    assertEquals(
      /removed|free/i.test(correctionText),
      false,
      `correction email must not claim removal or a free slot when the rollback write failed: ${correctionText}`,
    );
    assertStringIncludes(correctionText.toLowerCase(), "remove it by hand");
    // The booking id must be named so the host can find it in the
    // data file — read straight off disk, since the in-memory list
    // no longer has it (BookingsStore.mutate() assigns before it
    // awaits persist()).
    const onDisk = JSON.parse(await Deno.readTextFile(path));
    const diskId = onDisk[0]?.id;
    assertEquals(
      typeof diskId,
      "string",
      `on-disk booking: ${JSON.stringify(onDisk)}`,
    );
    assertStringIncludes(correctionText, diskId);
  } finally {
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

Deno.test("handleBookingSubmit: a failed owner send where the rollback write also fails pushes a neutral NTFY notice, not one naming the confirmation email", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  makePersistFailOnCall(bookings, 2, "simulated disk write failure");
  const date = futureWeekday(3, HOST_TZ);
  const sentTo: string[] = [];
  // Fails every send to the owner's address — lib/book.ts sends the
  // owner's "New booking" email first, so this fails on that very
  // first send and the guest send is never attempted. `sentTo` staying
  // empty below is what proves it was the owner's own send that
  // failed, not the guest's confirmation.
  setTransportForTesting(failingAddressTransport(cfg.hostEmail, sentTo));

  const originalFetch = globalThis.fetch;
  let pushBody = "";
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    pushBody = String(init?.body ?? "");
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  Deno.env.set("NTFY_URL", "https://ntfy.example.com");
  Deno.env.set("NTFY_TOPIC", "mig-test");
  Deno.env.set("NTFY_TOKEN", "test-token");

  try {
    const res = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
        fields: validFields(date, "09:00"),
      }),
      "",
    );
    assertEquals(res.status, 303);
    assertEquals(
      sentTo,
      [],
      `nothing should have sent — the owner's own send must be the one that failed: ${sentTo}`,
    );
    const lower = pushBody.toLowerCase();
    assertEquals(
      lower.includes("confirmation email"),
      false,
      `push must not blame "the confirmation email" when the owner's own send failed: ${pushBody}`,
    );
    assertStringIncludes(lower, "an email failed to send");
    assertStringIncludes(lower, "may still be on disk");
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("NTFY_URL");
    Deno.env.delete("NTFY_TOPIC");
    Deno.env.delete("NTFY_TOKEN");
    Deno.env.delete("NTFY_MODE");
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

Deno.test("handleBookingSubmit: the NTFY push for a failed send happens after the rollback has already run", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const sentTo: string[] = [];
  // Fails only the guest address — the owner send goes out first and
  // must succeed, so the rollback this test measures the push against
  // is triggered by a real guest-send failure, not the owner's.
  setTransportForTesting(
    failingAddressTransport("visitor@example.com", sentTo),
  );

  const originalFetch = globalThis.fetch;
  let storeSizeAtPushTime = -1;
  globalThis.fetch = ((_input: unknown, _init?: RequestInit) => {
    // If the push fired before the rollback ran, the booking would
    // still be in the store at this exact moment.
    storeSizeAtPushTime =
      bookings.list().filter((b) => b.date === date && b.time === "09:00")
        .length;
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  Deno.env.set("NTFY_URL", "https://ntfy.example.com");
  Deno.env.set("NTFY_TOPIC", "mig-test");
  Deno.env.set("NTFY_TOKEN", "test-token");

  try {
    const res = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
        fields: validFields(date, "09:00"),
      }),
      "",
    );
    assertEquals(res.status, 303);
    // Same "New booking" + correction shape as the two tests above.
    assertEquals(
      sentTo,
      [cfg.hostEmail, cfg.hostEmail],
      `the owner must have gotten "New booking" then the correction: ${sentTo}`,
    );
    assertEquals(
      storeSizeAtPushTime,
      0,
      "the booking must already be gone from the store when the push fires",
    );
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("NTFY_URL");
    Deno.env.delete("NTFY_TOPIC");
    Deno.env.delete("NTFY_TOKEN");
    Deno.env.delete("NTFY_MODE");
    setTransportForTesting(defaultTransport());
    await rm(path);
  }
});

// ─── mig#57: behaviour that changed with the move to ts-libs ─────────

// The limiter is @spy4x/platform's MemoryRateLimiter now; mig still
// refuses the submission over the limit and names the wait. No other
// test reaches this branch: the existing "rate-limited redirect" tests
// resubmit the same slot, which a conflict redirect also satisfies.
Deno.test("mig#57: a submission over the rate limit is refused with the wait time", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const rateLimiter = new MemoryRateLimiter({ windowMs: 300_000, limit: 1 });

  try {
    await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter,
        fields: validFields(date, "09:00"),
      }),
      "",
    );
    const second = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter,
        fields: validFields(date, "09:30"),
      }),
      "",
    );

    const url = new URL(second.headers.get("location")!);
    assertEquals(
      url.searchParams.get("err"),
      "Too many attempts. Try again in 5 minutes.",
    );
    assertEquals(bookings.forDate(date).length, 1);
  } finally {
    await rm(path);
  }
});

// @spy4x/platform's clientIp ignores every proxy header unless told to
// trust them; mig always trusted them. Without that trust, every
// visitor behind the reverse proxy would share one "0.0.0.0" bucket.
Deno.test("mig#57: visitors with different forwarded addresses are rate-limited separately", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const rateLimiter = new MemoryRateLimiter({ windowMs: 300_000, limit: 1 });

  try {
    const first = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter,
        fields: validFields(date, "09:00"),
        headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.9" },
      }),
      "",
    );
    const second = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter,
        fields: validFields(date, "09:30"),
        headers: { "x-forwarded-for": "198.51.100.2, 203.0.113.9" },
      }),
      "",
    );

    assertEquals(locationPath(first).startsWith("/confirmed?"), true);
    assertEquals(locationPath(second).startsWith("/confirmed?"), true);
  } finally {
    await rm(path);
  }
});

// mig's own clientIp took X-Forwarded-For's first hop even when it was
// empty (", 203.0.113.9"), so every such visitor shared one "" bucket;
// @spy4x/platform's skips an empty hop and falls through to X-Real-IP.
Deno.test("mig#57: an empty first X-Forwarded-For hop falls through to X-Real-IP", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const rateLimiter = new MemoryRateLimiter({ windowMs: 300_000, limit: 1 });

  try {
    const first = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter,
        fields: validFields(date, "09:00"),
        headers: {
          "x-forwarded-for": ", 203.0.113.9",
          "x-real-ip": "198.51.100.1",
        },
      }),
      "",
    );
    const second = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter,
        fields: validFields(date, "09:30"),
        headers: {
          "x-forwarded-for": ", 203.0.113.9",
          "x-real-ip": "198.51.100.2",
        },
      }),
      "",
    );

    assertEquals(locationPath(first).startsWith("/confirmed?"), true);
    assertEquals(locationPath(second).startsWith("/confirmed?"), true);
  } finally {
    await rm(path);
  }
});

// @spy4x/time/tz's zonedDateTime resolves Berlin's nonexistent 02:30 on
// 2027-03-28 (a Sunday; clocks jump 02:00 -> 03:00) to 03:30, so without
// a guard the write path would book a second 03:30 under the name
// "02:30". The slot was never offered (lib/availability.test.ts), and a
// hand-made POST for it is refused the same way.
Deno.test("mig#57: a slot inside the spring-forward gap is refused", async () => {
  const cfg = {
    ...fakeConfig(),
    weeklyAvailability: parseWeeklyAvailability("SUN 01:00-04:00"),
  };
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();

  try {
    const res = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
        fields: validFields("2027-03-28", "02:30"),
      }),
      "",
    );

    const url = new URL(res.headers.get("location")!);
    assertEquals(url.pathname, "/");
    assertEquals(
      url.searchParams.get("err"),
      "That time is outside availability hours.",
    );
    assertEquals(bookings.forDate("2027-03-28").length, 0);
  } finally {
    await rm(path);
  }
});
