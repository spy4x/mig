// handleBookingSubmit's redirect targets, for both base paths.
//
// The reviewer found these untested: a real fix here is a one-line
// change (swap a literal base path), and swapping it silently sends a
// standalone booking to the chrome-less /embed/confirmed page, or an
// embed booking out to the full site — exactly the bug issue #11 is
// about, just on the write path instead of the read path. Every test
// below asserts the `Location` header's pathname, not just "success".

import { assertEquals, assertStringIncludes } from "@std/assert";
import nodemailer from "nodemailer";
import type { Context } from "fresh";
import type { State } from "./utils.ts";
import type { Config } from "./types.ts";
import { BookingsStore } from "./bookings.ts";
import { RateLimiter } from "./ratelimit.ts";
import { getSlotsForDate, parseWeeklyAvailability } from "./availability.ts";
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
  data: { to?: string };
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
 *  on. Lets a test single out an owner-send failure from a
 *  guest-send failure without caring which one lib/email.ts happens
 *  to attempt first. */
function failingAddressTransport(addressToFail: string, sentTo: string[]) {
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
  // deno-lint-ignore no-explicit-any
  const anyStore = store as any;
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

Deno.test("mig#15 round 2: an availability failure drops slot but keeps date and tz on the redirect", async () => {
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
  // mig#15 round 2: 08:00 was never a bookable slot at all — keeping
  // it on the redirect would land the visitor on the confirm step for
  // a slot that was never valid to begin with.
  assertEquals(url.searchParams.get("slot"), null);
  assertEquals(url.searchParams.get("tz"), "America/New_York");
  await rm(path);
});

Deno.test("mig#15 round 2: a slot-taken conflict drops slot from the redirect (keeps date and tz)", async () => {
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
  const ctx = stubContext({
    config: cfg,
    bookings,
    rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
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
  // sent mail before checking for a conflict. Nothing is ever sent to
  // the loser now, so the message must not claim otherwise.
  const err = (url.searchParams.get("err") ?? "").toLowerCase();
  assertEquals(err.includes("email"), false, err);
  await rm(path);
});

// ─── Rate limit ────────────────────────────────────────────────────────

Deno.test("a rate-limited redirect keeps date and tz", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  // max: 1 — the first submission consumes the only slot in the
  // window, so the second one below is the one that gets rate-limited.
  const rateLimiter = new RateLimiter({ windowMs: 300_000, max: 1 });
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
  // max: 1 — the first submission consumes the only slot in the
  // window, same as the test above, so the second one is the one
  // that's rate-limited and hits the cap.
  const rateLimiter = new RateLimiter({ windowMs: 300_000, max: 1 });
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
      rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
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
  const rateLimiter = new RateLimiter({ windowMs: 300_000, max: 10 });

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
    // deterministic — see mutation (a) in the PR body: reverting
    // lib/book.ts to send-then-save turns this test red without any
    // change here.
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
      rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
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
  const rateLimiter = new RateLimiter({ windowMs: 300_000, max: 10 });
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

// ─── mig#19 review round 1: owner email goes out first, then guest ──────

Deno.test("mig#19: a guest-send failure still reaches the owner first, then rolls back", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const sentTo: string[] = [];
  // validFields()'s default guest address.
  const guestEmail = "visitor@example.com";
  setTransportForTesting(failingAddressTransport(guestEmail, sentTo));

  try {
    const res = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
        fields: validFields(date, "09:00"),
      }),
      "",
    );
    assertEquals(res.status, 303);
    // Owner-first (lib/email.ts's sendBookingEmails): the owner's send
    // is attempted, and succeeds, before the guest's send is even
    // tried.
    assertEquals(sentTo, [cfg.hostEmail], `sent: ${sentTo}`);
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

Deno.test("mig#19: an owner-send failure reaches nobody, then rolls back", async () => {
  const cfg = fakeConfig();
  const path = tmpDataPath();
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);
  const sentTo: string[] = [];
  setTransportForTesting(failingAddressTransport(cfg.hostEmail, sentTo));

  try {
    const res = await handleBookingSubmit(
      stubContext({
        config: cfg,
        bookings,
        rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
        fields: validFields(date, "09:00"),
      }),
      "",
    );
    assertEquals(res.status, 303);
    // Owner-first means an owner-side failure never reaches the
    // guest's send at all: sendBookingEmails awaits the owner send
    // first and throws straight out of that await, so the guest send
    // a moment later in the function body never runs. Swap the order
    // in lib/email.ts back to guest-first and this goes red: the
    // guest send would succeed before the owner one failed.
    assertEquals(sentTo, [], `sent: ${sentTo}`);
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
