import { assertEquals } from "@std/assert";
import { generateIcs } from "../lib/ics.ts";
import { newCancelToken } from "../lib/tokens.ts";
import type { Booking, Config } from "../lib/types.ts";

function makeConfig(): Config {
  return {
    hostName: "Jane Doe",
    hostEmail: "jane@example.com",
    hostTz: "Europe/Berlin",
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    publicUrl: "https://meet.example.com",
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
      user: "u",
      pass: "p",
      from: "noreply@example.com",
    },
    cancelSecret: "x",
    port: 8080,
    dataPath: "./data/bookings.json",
    hideBranding: false,
    githubUrl: "https://github.com/spy4x/mig",
  };
}

Deno.test("generateIcs — VCALENDAR skeleton + single VEVENT", async () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZBK8M",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "Europe/Berlin",
    guestName: "Client",
    guestEmail: "client@example.com",
    cancelTokenHash: "h",
    status: "active",
  };
  const { raw } = await newCancelToken("x");
  const cancelUrl = `https://meet.example.com/cancel?id=01HXYZBK8M&t=${raw}`;
  const ics = generateIcs(b, cfg, cancelUrl);

  assertEquals(ics.includes("BEGIN:VCALENDAR"), true);
  assertEquals(ics.includes("END:VCALENDAR"), true);
  assertEquals(ics.includes("BEGIN:VEVENT"), true);
  assertEquals(ics.includes("END:VEVENT"), true);
  assertEquals(ics.includes("UID:01HXYZBK8M@mig"), true);
  assertEquals(ics.includes("SUMMARY:Meeting with Jane Doe"), true);
  assertEquals(ics.includes("https://meet.google.com/abc-defg-hij"), true);
  assertEquals(ics.includes("STATUS:CONFIRMED"), true);
  // DTSTART in UTC for Europe/Berlin 10:00 = 08:00Z (winter) or 08:00Z (summer — Aug = CEST = UTC+2 = 08:00Z)
  // Aug 28 2026 is in CEST → 10:00 local = 08:00 UTC
  assertEquals(ics.includes("DTSTART:20260828T080000Z"), true);
  // DTEND = +30min = 08:30Z
  assertEquals(ics.includes("DTEND:20260828T083000Z"), true);

  // DESCRIPTION structure — readable paragraphs separated by blank
  // lines (which `icsEscape` turns into literal "\n" tokens inside
  // the single DESCRIPTION value, but they survive the round-trip
  // in any RFC 5545-compliant client). The folding helper prefers
  // word boundaries so labels like "Meeting with Jane Doe" stay
  // intact across fold boundaries.
  assertEquals(ics.includes("DESCRIPTION:"), true);
  assertEquals(ics.includes("Meeting with Jane Doe"), true);
  assertEquals(ics.includes("Booked via mig"), true);
  assertEquals(ics.includes("Cancel:"), true);
  // The cancel URL itself is one logical piece — it may be folded
  // across multiple lines, but every octet is present.
  assertEquals(
    ics.includes("meet.example.com/cancel?id=01HXYZBK8M&t="),
    true,
  );
  assertEquals(ics.includes(cancelUrl), true);
  // Notes section is omitted when there are no notes.
  assertEquals(ics.includes("Looking forward"), false);
});

// RFC 5545 §3.1 — lines starting with SPACE or HTAB are
// continuations of the previous line. Strip those so we can
// substring-match against logical content rather than raw bytes.
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "");
}

Deno.test("generateIcs — description includes guest notes when present", async () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZBK8M",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "Europe/Berlin",
    guestName: "Client",
    guestEmail: "client@example.com",
    notes: "Looking forward; please share the deck ahead.",
    cancelTokenHash: "h",
    status: "active",
  };
  const { raw } = await newCancelToken("x");
  const ics = generateIcs(
    b,
    cfg,
    `https://meet.example.com/cancel?id=01HXYZBK8M&t=${raw}`,
  );

  // Notes are inlined into the DESCRIPTION on their own paragraph.
  // After unfolding (RFC 5545 §3.1 line continuation), the full
  // note string should be present, semicolon-escaped as `\;` per
  // RFC 5545 (calendar clients unescape on render).
  const flat = unfold(ics);
  assertEquals(
    flat.includes("Looking forward\\; please share the deck ahead."),
    true,
  );
});

Deno.test("generateIcs — empty / whitespace notes are dropped", async () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZBK8M",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "Europe/Berlin",
    guestName: "Client",
    guestEmail: "client@example.com",
    notes: "   \n  ",
    cancelTokenHash: "h",
    status: "active",
  };
  const { raw } = await newCancelToken("x");
  const ics = generateIcs(
    b,
    cfg,
    `https://meet.example.com/cancel?id=01HXYZBK8M&t=${raw}`,
  );

  // Whitespace-only notes don't trigger a notes section.
  assertEquals(ics.includes("Looking forward"), false);
});

Deno.test("generateIcs — escapes commas and semicolons in fields", async () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZ",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "UTC",
    guestName: "Lastname, Firstname; PhD",
    guestEmail: "client@example.com",
    cancelTokenHash: "h",
    status: "active",
  };
  const { raw } = await newCancelToken("x");
  const ics = generateIcs(b, cfg, `https://example.com/c?t=${raw}`);
  assertEquals(ics.includes("Lastname\\, Firstname\\; PhD"), true);
});

Deno.test("generateIcs — cancelled status reflects", async () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZ",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "UTC",
    guestName: "Client",
    guestEmail: "client@example.com",
    cancelTokenHash: "h",
    status: "cancelled",
  };
  const { raw } = await newCancelToken("x");
  const ics = generateIcs(b, cfg, `https://example.com/c?t=${raw}`);
  assertEquals(ics.includes("STATUS:CANCELLED"), true);
});
