// POST /api/book must always send a successful booking to
// /confirmed — never /embed/confirmed, which has no header, footer,
// or theme toggle and would be a jarring, unbranded landing page for
// a visitor who booked on the full site. This test goes through the
// route module itself (not lib/book.ts directly) so that swapping the
// "" literal in routes/api/book.ts for "/embed" turns it red.

import { assertEquals } from "@std/assert";
import type { Context } from "fresh";
import type { State } from "../../lib/utils.ts";
import type { Config } from "../../lib/types.ts";
import { BookingsStore } from "../../lib/bookings.ts";
import { MemoryRateLimiter } from "@spy4x/platform/rate-limit/memory";
import { parseWeeklyAvailability } from "../../lib/availability.ts";
import { addDays, dayOfWeek, isoDateInTz } from "@spy4x/time/tz";
import { setTransportForTesting } from "../../lib/email.ts";
import { MAX_BOOKING_BODY_BYTES } from "../../lib/book.ts";
import { handler } from "./book.ts";

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
    dataPath: "/tmp/mig-api-book-test-unused.json",
    hideBranding: false,
    githubUrl: "https://github.com/spy4x/mig",
    version: "test",
  };
}

function futureWeekday(daysAhead: number, tz: string): string {
  let d = addDays(isoDateInTz(new Date(), tz), daysAhead, tz);
  while (dayOfWeek(d, tz) === "SAT" || dayOfWeek(d, tz) === "SUN") {
    d = addDays(d, 1, tz);
  }
  return d;
}

async function rm(path: string) {
  try {
    await Deno.remove(path);
  } catch {
    // ignore
  }
}

// Every send resolves at once with no network I/O.
setTransportForTesting({ sendMail: () => Promise.resolve({}) });

Deno.test("POST /api/book: a successful booking redirects to /confirmed, not /embed/confirmed", async () => {
  const cfg = fakeConfig();
  const path = `/tmp/mig-api-book-test-${crypto.randomUUID()}.json`;
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const date = futureWeekday(3, HOST_TZ);

  const body = new URLSearchParams({
    name: "Visitor",
    email: "visitor@example.com",
    notes: "",
    date,
    slot: "09:00",
    website: "",
  });
  const req = new Request("http://localhost/api/book", {
    method: "POST",
    body,
  });
  const ctx = {
    req,
    // The socket address handleBookingSubmit falls back to (mig#59).
    info: {
      remoteAddr: { transport: "tcp", hostname: "192.0.2.1", port: 40000 },
    },
    state: {
      config: cfg,
      bookings,
      rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
    },
  } as unknown as Context<State>;

  const res = await handler.POST!(ctx);
  assertEquals(res.status, 303);
  const location = new URL(res.headers.get("location")!);
  assertEquals(
    location.pathname.startsWith("/confirmed"),
    true,
    location.pathname,
  );
  assertEquals(
    location.pathname.startsWith("/embed"),
    false,
    location.pathname,
  );
  await rm(path);
});

// Submits one booking for `date` at `slot` and returns the redirect.
async function submit(
  date: string,
  slot: string,
  hostTz: string,
  bookings: BookingsStore,
): Promise<URL> {
  const body = new URLSearchParams({
    name: "Visitor",
    email: "visitor@example.com",
    notes: "",
    date,
    slot,
    website: "",
  });
  const ctx = {
    req: new Request("http://localhost/api/book", { method: "POST", body }),
    // The socket address handleBookingSubmit falls back to (mig#59).
    info: {
      remoteAddr: { transport: "tcp", hostname: "192.0.2.1", port: 40000 },
    },
    state: {
      config: { ...fakeConfig(), hostTz },
      bookings,
      rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
    },
  } as unknown as Context<State>;
  const res = await handler.POST!(ctx);
  assertEquals(res.status, 303);
  return new URL(res.headers.get("location")!);
}

// mig#57: Phoenix ran on local mean time, UTC-7:28:18, until noon on
// 1883-11-18, and @spy4x/time/tz's zonedDateTime refuses an offset with
// seconds rather than answer up to a minute wrong. The date passes the
// calendar check, and its noon resolves, but its 09:00 does not. Every
// date before 1980 is refused before any zone math runs; 1980-01-01
// gets as far as the past-time check.
Deno.test("POST /api/book: a date before 1980 is refused", async () => {
  const path = `/tmp/mig-api-book-test-${crypto.randomUUID()}.json`;
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();

  try {
    const phoenix = await submit(
      "1883-11-18",
      "09:00",
      "America/Phoenix",
      bookings,
    );
    const lastBefore = await submit("1979-12-31", "09:00", HOST_TZ, bookings);
    const first = await submit("1980-01-01", "09:00", HOST_TZ, bookings);

    assertEquals(phoenix.pathname, "/");
    assertEquals(
      phoenix.searchParams.get("err"),
      "That date is not available for booking.",
    );
    assertEquals(
      lastBefore.searchParams.get("err"),
      "That date is not available for booking.",
    );
    assertEquals(
      first.searchParams.get("err"),
      "That time is no longer available.",
    );
    assertEquals(bookings.list().length, 0);
  } finally {
    await rm(path);
  }
});

// mig#73: the form is read with a byte cap, so an oversized body is
// refused with 413 before it is buffered, and no booking is made.
async function postOversized(streamed: boolean): Promise<{
  res: Response;
  stored: number;
}> {
  const path = `/tmp/mig-book-oversize-test-${crypto.randomUUID()}.json`;
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  const form = new URLSearchParams({
    name: "Visitor",
    email: "visitor@example.com",
    notes: "x".repeat(MAX_BOOKING_BODY_BYTES),
    date: futureWeekday(3, HOST_TZ),
    slot: "09:00",
    website: "",
  }).toString();
  const bytes = new TextEncoder().encode(form);
  // A streamed body carries no Content-Length, so only the running
  // byte count can stop it.
  const body = streamed
    ? new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    })
    : bytes;
  const req = new Request("http://localhost/api/book", {
    method: "POST",
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
  const ctx = {
    req,
    info: {
      remoteAddr: { transport: "tcp", hostname: "192.0.2.1", port: 40001 },
    },
    state: {
      config: fakeConfig(),
      bookings,
      rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
    },
  } as unknown as Context<State>;
  try {
    const res = await handler.POST!(ctx);
    return { res, stored: bookings.list().length };
  } finally {
    await rm(path);
  }
}

Deno.test("POST /api/book: an oversized body is rejected with 413 and books nothing", async () => {
  const { res, stored } = await postOversized(false);
  assertEquals(res.status, 413);
  assertEquals(stored, 0);
});

Deno.test("POST /api/book: an oversized streamed body without Content-Length is rejected with 413", async () => {
  const { res, stored } = await postOversized(true);
  assertEquals(res.status, 413);
  assertEquals(stored, 0);
});
