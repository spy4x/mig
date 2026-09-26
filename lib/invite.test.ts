import { assertEquals } from "@std/assert";
import { bookingIcs } from "./invite.ts";
import { randomBase64Url } from "@spy4x/platform/tokens";
import type { Booking, Config } from "./types.ts";
import { zonedDateTime } from "@spy4x/time/tz";
import { formatClockLongAt } from "./clock.ts";

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
    cancelSecret: "fake-cancel-secret-only-for-tests",
    port: 8080,
    dataPath: "./data/bookings.json",
    hideBranding: false,
    githubUrl: "https://github.com/spy4x/mig",
    version: "test",
  };
}

Deno.test("bookingIcs — VCALENDAR skeleton + single VEVENT", () => {
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
  const raw = randomBase64Url();
  const cancelUrl = `https://meet.example.com/cancel?id=01HXYZBK8M&t=${raw}`;
  const ics = bookingIcs(b, cfg, cancelUrl);
  const flatIcs = unfold(ics);

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
  // lines (which the ICS writer turns into literal "\n" tokens inside
  // the single DESCRIPTION value, but they survive the round-trip
  // in any RFC 5545-compliant client). The folding helper prefers
  // word boundaries so labels like "Meeting with Jane Doe" stay
  // intact across fold boundaries.
  assertEquals(ics.includes("DESCRIPTION:"), true);
  assertEquals(flatIcs.includes("Meeting with Jane Doe"), true);
  assertEquals(flatIcs.includes("Booked via mig"), true);
  assertEquals(flatIcs.includes("Cancel:"), true);
  // The cancel URL itself is one logical piece — it may be folded
  // across multiple lines, but every octet is present.
  assertEquals(
    flatIcs.includes("meet.example.com/cancel?id=01HXYZBK8M&t="),
    true,
  );
  assertEquals(flatIcs.includes(cancelUrl), true);
  // Notes section is omitted when there are no notes.
  assertEquals(ics.includes("Looking forward"), false);
});

Deno.test("bookingIcs — visitor description uses visitor timezone", () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZBK8M",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "Europe/Berlin",
    guestTz: "America/New_York",
    guestName: "Client",
    guestEmail: "client@example.com",
    cancelTokenHash: "h",
    status: "active",
  };
  const raw = randomBase64Url();
  const ics = unfold(
    bookingIcs(b, cfg, `https://example.com/c?t=${raw}`, b.guestTz),
  );

  assertEquals(ics.includes("DTSTART:20260828T080000Z"), true);
  // mig#15: the description reads "..., City, UTC±N", not a raw IANA
  // zone name — every comma in that trailer is itself escaped per RFC
  // 5545, same as the one after "Friday".
  assertEquals(
    ics.includes(
      "Friday\\, 28 August 2026 at 04:00\\, New York\\, UTC-4",
    ),
    true,
  );
});

// RFC 5545 §3.1 — lines starting with SPACE or HTAB are
// continuations of the previous line. Strip those so we can
// substring-match against logical content rather than raw bytes.
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "");
}

// The invite description used to build its own "time, city, offset"
// string instead of the shared formatter, so a bare zone like "UTC"
// doubled up ("...at 02:00, UTC, UTC+0") instead of matching what the
// guest email actually says. These two tests pin the description to
// `formatClockLongAt` — the same call `guestText`/`guestHtml` in
// lib/email.ts make — for a bare zone and an `Etc/*` offset zone, the
// two cases the hand-built string got wrong.
Deno.test("bookingIcs — UTC description matches the guest email's time string", () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZBK8M",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "Europe/Berlin",
    guestTz: "UTC",
    guestName: "Client",
    guestEmail: "client@example.com",
    cancelTokenHash: "h",
    status: "active",
  };
  const raw = randomBase64Url();
  const ics = unfold(
    bookingIcs(b, cfg, `https://example.com/c?t=${raw}`, b.guestTz),
  );

  // DTSTART is unaffected by the description fix.
  assertEquals(ics.includes("DTSTART:20260828T080000Z"), true);

  const start = zonedDateTime(b.date, b.time, b.hostTz);
  const guestEmailWhen = formatClockLongAt(start, "UTC");
  assertEquals(guestEmailWhen, "Friday, 28 August 2026 at 08:00, UTC");
  const escaped = guestEmailWhen.replaceAll(",", "\\,");
  assertEquals(ics.includes(escaped), true);
  // No doubled-up "UTC, UTC+0" from a hand-built offset suffix.
  assertEquals(ics.includes("UTC\\, UTC"), false);
});

Deno.test("bookingIcs — Etc/GMT+5 description shows the offset only", () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZBK8M",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "Europe/Berlin",
    guestTz: "Etc/GMT+5",
    guestName: "Client",
    guestEmail: "client@example.com",
    cancelTokenHash: "h",
    status: "active",
  };
  const raw = randomBase64Url();
  const ics = unfold(
    bookingIcs(b, cfg, `https://example.com/c?t=${raw}`, b.guestTz),
  );

  assertEquals(ics.includes("DTSTART:20260828T080000Z"), true);

  const start = zonedDateTime(b.date, b.time, b.hostTz);
  const guestEmailWhen = formatClockLongAt(start, "Etc/GMT+5");
  assertEquals(guestEmailWhen, "Friday, 28 August 2026 at 03:00, UTC-5");
  const escaped = guestEmailWhen.replaceAll(",", "\\,");
  assertEquals(ics.includes(escaped), true);
  // "GMT+5" is not a place name — it must never appear as a city.
  assertEquals(ics.includes("GMT+5"), false);
});

// mig#24 review follow-up: generateIcs's 5th param, `visitorTz`, folds
// the visitor's clock into the owner's own invite via formatOwnerClock
// — the same helper the owner email body uses — so the description
// stops being host-clock-only for the one recipient whose email
// already shows both. Only lib/email.ts's ownerIcs call passes it; the
// guest's own ics call never does, and the tests above (called without
// it) already pin that DESCRIPTION stays `formatClockLongAt` alone.
Deno.test("bookingIcs — visitorTz folds the visitor's clock into the description", () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZBK8M",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "Europe/Berlin",
    guestTz: "America/New_York",
    guestName: "Client",
    guestEmail: "client@example.com",
    cancelTokenHash: "h",
    status: "active",
  };
  const raw = randomBase64Url();
  const ics = unfold(
    bookingIcs(
      b,
      cfg,
      `https://example.com/c?t=${raw}`,
      b.hostTz,
      b.guestTz,
    ),
  );
  assertEquals(
    ics.includes(
      "Friday\\, 28 August 2026 at 10:00\\, Berlin\\, UTC+2 (visitor: 04:00\\, New York\\, UTC-4)",
    ),
    true,
  );
});

// formatOwnerClock's `hostTz` argument doubles as the zone
// `booking.date`/`booking.time` (host-local wall-clock values) are
// *interpreted* in — not a generic "which zone to show". Calling
// generateIcs with a `displayTz` other than `booking.hostTz` must not
// change what instant the description describes: it always matches
// DTSTART's real instant, regardless of `displayTz`.
Deno.test("bookingIcs — visitorTz anchors the host clock to the real host zone, even when displayTz differs", () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZBK8M",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "Europe/Berlin",
    guestTz: "America/New_York",
    guestName: "Client",
    guestEmail: "client@example.com",
    cancelTokenHash: "h",
    status: "active",
  };
  const raw = randomBase64Url();
  // displayTz ("Asia/Tokyo") deliberately differs from b.hostTz
  // ("Europe/Berlin"); no real caller does this today (lib/email.ts
  // always passes booking.hostTz), but generateIcs must not depend on
  // that to stay correct.
  const ics = unfold(
    bookingIcs(
      b,
      cfg,
      `https://example.com/c?t=${raw}`,
      "Asia/Tokyo",
      b.guestTz,
    ),
  );
  // DTSTART: Berlin 10:00 CEST = 08:00Z — unaffected by displayTz.
  assertEquals(ics.includes("DTSTART:20260828T080000Z"), true);
  // The description's host clock must describe that same instant, in
  // the real host zone — identical to the "visitorTz folds..." test
  // above despite the different displayTz argument.
  assertEquals(
    ics.includes(
      "Friday\\, 28 August 2026 at 10:00\\, Berlin\\, UTC+2 (visitor: 04:00\\, New York\\, UTC-4)",
    ),
    true,
  );
  assertEquals(ics.includes("Tokyo"), false);
});

Deno.test("bookingIcs — visitorTz omits the visitor clock when no valid zone was captured", () => {
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
  const raw = randomBase64Url();
  const ics = unfold(
    bookingIcs(
      b,
      cfg,
      `https://example.com/c?t=${raw}`,
      b.hostTz,
      "Not/A_Timezone",
    ),
  );
  assertEquals(
    ics.includes("Friday\\, 28 August 2026 at 10:00\\, Berlin\\, UTC+2"),
    true,
  );
  assertEquals(ics.includes("visitor:"), false);
});

Deno.test("bookingIcs — description includes guest notes when present", () => {
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
  const raw = randomBase64Url();
  const ics = bookingIcs(
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

Deno.test("bookingIcs — empty / whitespace notes are dropped", () => {
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
  const raw = randomBase64Url();
  const ics = bookingIcs(
    b,
    cfg,
    `https://meet.example.com/cancel?id=01HXYZBK8M&t=${raw}`,
  );

  // Whitespace-only notes don't trigger a notes section.
  assertEquals(ics.includes("Looking forward"), false);
});

Deno.test("bookingIcs — RFC 6868-encodes CN parameter delimiters", () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZ",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "UTC",
    guestName: 'Visitor";ROLE=CHAIR^\nInjected',
    guestEmail: "client@example.com",
    cancelTokenHash: "h",
    status: "active",
  };
  const raw = randomBase64Url();
  const ics = unfold(bookingIcs(b, cfg, `https://example.com/c?t=${raw}`));

  assertEquals(
    ics.includes('CN="Visitor^\';ROLE=CHAIR^^^nInjected";RSVP=TRUE'),
    true,
  );
});

Deno.test("bookingIcs — a cancelled booking is a CANCELLED event sent with METHOD:CANCEL", () => {
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
  const raw = randomBase64Url();
  const ics = bookingIcs(b, cfg, `https://example.com/c?t=${raw}`);
  assertEquals(ics.includes("STATUS:CANCELLED"), true);
  // mig#57: @spy4x/time/ics pairs a CANCELLED event with METHOD:CANCEL;
  // mig's own writer sent METHOD:REQUEST whatever the status.
  assertEquals(ics.includes("METHOD:CANCEL\r\n"), true);
  assertEquals(ics.includes("METHOD:REQUEST"), false);
});

// mig#57: DTSTART comes from @spy4x/time/tz's zonedDateTime now. mig's
// own copy read the zone's offset at the wrong instant near a
// daylight-saving change: an Auckland host's 15:00 slot on 2026-04-04
// (NZDT, UTC+13, the day before clocks go back) came out an hour late,
// at 03:00Z instead of 02:00Z.
Deno.test("bookingIcs — DTSTART of an afternoon slot the day before DST ends is the real instant", () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZ",
    createdAt: "2026-03-25T16:42:00.000Z",
    date: "2026-04-04",
    time: "15:00",
    hostTz: "Pacific/Auckland",
    guestName: "Client",
    guestEmail: "client@example.com",
    cancelTokenHash: "h",
    status: "active",
  };
  const raw = randomBase64Url();
  const ics = bookingIcs(b, cfg, `https://example.com/c?t=${raw}`);

  assertEquals(ics.includes("DTSTART:20260404T020000Z\r\n"), true);
});

// mig#57: 02:30 happens twice in Berlin on 2026-10-25. @spy4x/time/tz
// picks the first (summer time, 00:30Z); mig's own copy picked the
// second (winter time, 01:30Z).
Deno.test("bookingIcs — a slot in the repeated fall-back hour starts at its first occurrence", () => {
  const cfg = makeConfig();
  const b: Booking = {
    id: "01HXYZ",
    createdAt: "2026-10-01T16:42:00.000Z",
    date: "2026-10-25",
    time: "02:30",
    hostTz: "Europe/Berlin",
    guestName: "Client",
    guestEmail: "client@example.com",
    cancelTokenHash: "h",
    status: "active",
  };
  const raw = randomBase64Url();
  const ics = bookingIcs(b, cfg, `https://example.com/c?t=${raw}`);

  assertEquals(ics.includes("DTSTART:20261025T003000Z\r\n"), true);
});
