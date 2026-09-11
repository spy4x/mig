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

  assertStringIncludes(emails.guest.subject, "04:00");
  assertStringIncludes(emails.guest.text, "04:00 (America/New_York)");
  assertStringIncludes(
    emails.guest.attachments![0].content.replace(/\r\n[ \t]/g, ""),
    "America/New_York",
  );
  assertStringIncludes(emails.owner.subject, "10:00");
  assertStringIncludes(emails.owner.text, "10:00 (Europe/Berlin)");
  assertStringIncludes(
    emails.owner.attachments![0].content.replace(/\r\n[ \t]/g, ""),
    "Europe/Berlin",
  );
});

Deno.test("cancellation emails use recipient timezones", () => {
  const emails = buildCancellationEmails(
    makeConfig(),
    makeBooking("America/New_York"),
    "guest",
    undefined,
  );

  assertStringIncludes(emails.guest.text, "04:00 (America/New_York)");
  assertStringIncludes(emails.owner.text, "10:00 (Europe/Berlin)");
});

Deno.test("email output falls back for missing or invalid visitor timezone", () => {
  for (const guestTz of [undefined, "Not/A_Timezone"]) {
    const emails = buildBookingEmails(
      makeConfig(),
      makeBooking(guestTz),
      "https://mig.example.com/cancel",
    );

    assertStringIncludes(emails.guest.text, "10:00 (Europe/Berlin)");
    assertEquals(emails.guest.subject, "Booking confirmed: Fri 28 Aug 10:00");
  }
});
