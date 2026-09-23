import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildBookingEmails, buildCancellationEmails } from "./email.ts";
import type { Booking, Config } from "./types.ts";

function makeConfig(): Config {
  return {
    hostName: "Host",
    hostEmail: "host@example.com",
    hostTz: "Europe/Berlin",
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
    bookingHorizonDays: 14,
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

function makeBooking(guestTz?: string): Booking {
  return {
    id: "01HXYZBK8M",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "Europe/Berlin",
    guestTz,
    guestName: "Visitor",
    guestEmail: "visitor@example.com",
    cancelTokenHash: "hash",
    status: "active",
  };
}

Deno.test("booking emails use recipient timezones", () => {
  const emails = buildBookingEmails(
    makeConfig(),
    makeBooking("America/New_York"),
    "https://mig.example.com/cancel",
  );

  // Guest: only their own clock, never the host's raw IANA name.
  assertStringIncludes(emails.guest.subject, "04:00");
  assertStringIncludes(emails.guest.subject, "New York, UTC-4");
  assertStringIncludes(emails.guest.text, "04:00");
  assertStringIncludes(emails.guest.text, "New York, UTC-4");
  assertStringIncludes(
    emails.guest.attachments![0].content.replace(/\r\n[ \t]/g, ""),
    "New York",
  );
  // Owner: host clock plus the visitor's clock alongside it (mig#15).
  assertStringIncludes(emails.owner.subject, "10:00");
  assertStringIncludes(emails.owner.subject, "Berlin, UTC+2");
  assertStringIncludes(emails.owner.text, "10:00");
  assertStringIncludes(emails.owner.text, "Berlin, UTC+2");
  assertStringIncludes(emails.owner.text, "visitor: 04:00, New York, UTC-4");
  assertStringIncludes(
    emails.owner.attachments![0].content.replace(/\r\n[ \t]/g, ""),
    "Berlin",
  );
});

Deno.test("cancellation emails use recipient timezones", () => {
  const emails = buildCancellationEmails(
    makeConfig(),
    makeBooking("America/New_York"),
    "guest",
    undefined,
  );

  assertStringIncludes(emails.guest.text, "04:00, New York, UTC-4");
  assertStringIncludes(emails.owner.text, "10:00, Berlin, UTC+2");
});

Deno.test("email output falls back for missing or invalid visitor timezone", () => {
  for (const guestTz of [undefined, "Not/A_Timezone"]) {
    const emails = buildBookingEmails(
      makeConfig(),
      makeBooking(guestTz),
      "https://mig.example.com/cancel",
    );

    assertStringIncludes(emails.guest.text, "10:00, Berlin, UTC+2");
    assertEquals(
      emails.guest.subject,
      "Booking confirmed: Fri 28 Aug 10:00, Berlin, UTC+2",
    );
    // No visitor zone known — the owner's email shows the host clock
    // alone, never a guessed visitor zone.
    assertEquals(
      emails.owner.text.includes("visitor:"),
      false,
      "owner email must not claim a visitor timezone that was never captured",
    );
  }
});

// ─── mig#15: two zones, two clocks ────────────────────────────────────
// Host in Ho Chi Minh (no DST, always UTC+7), guest in New York (EDT,
// UTC-4, unambiguous in October). This is the exact scenario from the
// issue: a 09:00 Tuesday slot in Ho Chi Minh is 22:00 Monday in New
// York.

function makeHoChiMinhConfig(): Config {
  return { ...makeConfig(), hostTz: "Asia/Ho_Chi_Minh" };
}

function makeCrossZoneBooking(): Booking {
  return {
    id: "01HXYZCROSSZONE",
    createdAt: "2026-10-01T00:00:00.000Z",
    date: "2026-10-06",
    time: "09:00",
    hostTz: "Asia/Ho_Chi_Minh",
    guestTz: "America/New_York",
    guestName: "Visitor",
    guestEmail: "visitor@example.com",
    cancelTokenHash: "hash",
    status: "active",
  };
}

Deno.test("mig#15: guest email (incl. subject) shows only the visitor's labelled clock", () => {
  const emails = buildBookingEmails(
    makeHoChiMinhConfig(),
    makeCrossZoneBooking(),
    "https://mig.example.com/cancel",
  );

  assertStringIncludes(emails.guest.subject, "New York, UTC-4");
  assertStringIncludes(emails.guest.subject, "22:00");
  assertStringIncludes(emails.guest.text, "22:00, New York, UTC-4");
  assertStringIncludes(emails.guest.html!, "22:00, New York, UTC-4");
});

Deno.test("mig#15: owner email shows both the host's and the visitor's labelled clock", () => {
  const emails = buildBookingEmails(
    makeHoChiMinhConfig(),
    makeCrossZoneBooking(),
    "https://mig.example.com/cancel",
  );

  for (const body of [emails.owner.text, emails.owner.html!]) {
    assertStringIncludes(body, "Ho Chi Minh, UTC+7");
    assertStringIncludes(body, "New York, UTC-4");
  }
});
