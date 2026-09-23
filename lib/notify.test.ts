// mig#15: NTFY pushes are what the owner reads on their phone — they
// must show the host's own clock plus the visitor's clock alongside
// it (never a raw IANA zone name, and never a guessed visitor zone
// when none was captured). These tests stub `fetch` so no network
// call happens, and set the three NTFY_* env vars only for the
// duration of each test.

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Booking, Config } from "./types.ts";
import {
  notifyBookingCancelled,
  notifyBookingEmailFailed,
  notifyBookingSucceeded,
} from "./notify.ts";

function makeConfig(): Config {
  return {
    hostName: "Jane Doe",
    hostEmail: "jane@example.com",
    hostTz: "Asia/Ho_Chi_Minh",
    meetingUrl: "https://meet.example.com/room",
    publicUrl: "https://mig.example.com",
    weeklyAvailability: {
      MON: [],
      TUE: [],
      WED: [],
      THU: [],
      FRI: [],
      SAT: [],
      SUN: [],
    },
    slotDurationMin: 30,
    minNoticeHours: 6,
    bookingHorizonDays: 60,
    blockedDates: new Set(),
    rateLimitPer5Min: 1,
    theme: "auto",
    smtp: {
      host: "smtp.example.com",
      port: 587,
      user: "user@example.com",
      pass: "placeholder",
      from: "Mig <mig@example.com>",
    },
    cancelSecret: "placeholder",
    port: 8080,
    dataPath: "./data/bookings.json",
    hideBranding: false,
    githubUrl: "https://github.com/spy4x/mig",
    version: "test",
  };
}

// Ho Chi Minh (host, no DST) / New York (guest, EDT in October — see
// mig#15's PR body for why October is DST-unambiguous for both).
function makeCrossZoneBooking(guestTz?: string): Booking {
  return {
    id: "01HXYZCROSSZONE",
    createdAt: "2026-10-01T00:00:00.000Z",
    date: "2026-10-06",
    time: "09:00",
    hostTz: "Asia/Ho_Chi_Minh",
    guestTz,
    guestName: "Visitor",
    guestEmail: "visitor@example.com",
    cancelTokenHash: "hash",
    status: "active",
  };
}

async function captureNtfyBody(send: () => Promise<void>): Promise<string> {
  const originalFetch = globalThis.fetch;
  let body = "";
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    body = String(init?.body ?? "");
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  Deno.env.set("NTFY_URL", "https://ntfy.example.com");
  Deno.env.set("NTFY_TOPIC", "mig-test");
  Deno.env.set("NTFY_TOKEN", "test-token");
  try {
    await send();
  } finally {
    globalThis.fetch = originalFetch;
    Deno.env.delete("NTFY_URL");
    Deno.env.delete("NTFY_TOPIC");
    Deno.env.delete("NTFY_TOKEN");
    Deno.env.delete("NTFY_MODE");
  }
  return body;
}

Deno.test("mig#15: booking-succeeded NTFY body shows the host's clock and the visitor's alongside it", async () => {
  const cfg = makeConfig();
  const booking = makeCrossZoneBooking("America/New_York");
  const body = await captureNtfyBody(() =>
    notifyBookingSucceeded(cfg, booking)
  );

  assertStringIncludes(body, "Ho Chi Minh, UTC+7");
  assertStringIncludes(body, "New York, UTC-4");
  // mig#15 review: the host clock and the visitor's carry their own
  // dates too (main had dropped the date entirely: `${date} ${time}`
  // with no zone at all) — the visitor's date differs from the
  // host's here, so it must show alongside the visitor's clock.
  assertStringIncludes(body, "Tue 6 Oct 09:00, Ho Chi Minh, UTC+7");
  assertStringIncludes(body, "visitor: Mon 5 Oct 22:00, New York, UTC-4");
});

Deno.test("mig#15: cancellation NTFY body shows the host's clock and the visitor's alongside it", async () => {
  const cfg = makeConfig();
  const booking = makeCrossZoneBooking("America/New_York");
  const body = await captureNtfyBody(() =>
    notifyBookingCancelled(cfg, booking, "guest", "changed my mind")
  );

  assertStringIncludes(body, "Ho Chi Minh, UTC+7");
  assertStringIncludes(body, "New York, UTC-4");
});

Deno.test("mig#15: NTFY never shows a raw ISO timestamp for Booked/At", async () => {
  const cfg = makeConfig();
  const booking = makeCrossZoneBooking("America/New_York");

  const bookedBody = await captureNtfyBody(() =>
    notifyBookingSucceeded(cfg, booking)
  );
  assertEquals(
    /\d{4}-\d{2}-\d{2}T/.test(bookedBody),
    false,
    "Booked: line must not be a raw ISO timestamp",
  );
  assertStringIncludes(bookedBody, "Booked: Thu 1 Oct");

  const cancelBody = await captureNtfyBody(() =>
    notifyBookingCancelled(cfg, booking, "guest", "changed my mind")
  );
  assertEquals(
    /\d{4}-\d{2}-\d{2}T/.test(cancelBody),
    false,
    "At: line must not be a raw ISO timestamp",
  );
});

Deno.test("mig#15: NTFY body never claims a visitor timezone that was never captured", async () => {
  const cfg = makeConfig();
  const booking = makeCrossZoneBooking(undefined);
  const body = await captureNtfyBody(() =>
    notifyBookingSucceeded(cfg, booking)
  );

  assertStringIncludes(body, "Ho Chi Minh, UTC+7");
  assertEquals(
    body.includes("visitor:"),
    false,
    "must not guess a visitor zone that was never captured",
  );
});

Deno.test("mig#19 review round 3: email-failed NTFY body says the booking was not created and removed", async () => {
  const cfg = makeConfig();
  const booking = makeCrossZoneBooking("America/New_York");
  const body = await captureNtfyBody(() =>
    notifyBookingEmailFailed(cfg, booking, "simulated SMTP failure")
  );

  // The previous wording ("booking confirmation email failed to
  // send") only described the failure, not its outcome — lib/book.ts
  // rolls the booking back on any send failure here, so the push must
  // say that plainly.
  const lower = body.toLowerCase();
  assertStringIncludes(lower, "not created");
  assertStringIncludes(lower, "removed");
});

Deno.test("email-failed NTFY body does not claim removal when the rollback itself failed", async () => {
  const cfg = makeConfig();
  const booking = makeCrossZoneBooking("America/New_York");
  const body = await captureNtfyBody(() =>
    notifyBookingEmailFailed(cfg, booking, "simulated SMTP failure", {
      rolledBack: false,
    })
  );

  // A rollback that failed to write leaves the booking possibly still
  // on disk (BookingsStore.mutate() assigns in-memory before it
  // awaits persist(), so only the disk copy is in doubt) — the push
  // must not tell the host it was removed or that the slot is free,
  // and must say where to remove it by hand.
  const lower = body.toLowerCase();
  assertEquals(lower.includes("removed"), false, body);
  assertEquals(lower.includes("free"), false, body);
  assertStringIncludes(lower, "may still be on disk");
  assertStringIncludes(body, booking.id);
});
