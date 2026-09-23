import { assertEquals } from "@std/assert";
import {
  formatClockAt,
  formatDateLong,
  formatInstantLong,
  formatInstantShort,
  formatTimeOfDay,
  validTimeZoneOr,
  zoneCity,
  zonedDateTime,
  zoneOffsetLabel,
} from "./tz.ts";
import { meetingSummary } from "./ics.ts";
import type { Booking } from "./types.ts";

Deno.test("formats host-local booking instant in visitor timezone", () => {
  const instant = zonedDateTime("2026-08-28", "10:00", "Europe/Berlin");

  assertEquals(
    formatInstantShort(instant, "America/New_York"),
    "Fri 28 Aug 04:00",
  );
  assertEquals(
    formatInstantLong(instant, "America/New_York"),
    "Friday, 28 August 2026 at 04:00",
  );
});

Deno.test("visitor timezone conversion handles date boundaries", () => {
  const instant = zonedDateTime("2026-08-28", "01:00", "Europe/Berlin");

  assertEquals(
    formatInstantShort(instant, "America/Los_Angeles"),
    "Thu 27 Aug 16:00",
  );
});

Deno.test("meeting summary falls back from invalid stored visitor timezone", () => {
  const booking: Booking = {
    id: "01HXYZ",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "Europe/Berlin",
    guestTz: "Not/A_Timezone",
    guestName: "Visitor",
    guestEmail: "visitor@example.com",
    cancelTokenHash: "hash",
    status: "active",
  };

  assertEquals(meetingSummary(booking), "Friday, 28 August 2026 at 10:00");
});

// ─── mig#15: "HH:MM, City, UTC±N" formatter ──────────────────────────
// October 2026 is DST-unambiguous for both zones under test: New York
// is EDT (UTC-4) until 1 Nov 2026, and Ho Chi Minh has no DST at all
// (always UTC+7).

Deno.test("zoneCity: last path segment, underscores replaced by spaces", () => {
  assertEquals(zoneCity("America/New_York"), "New York");
  assertEquals(zoneCity("Asia/Ho_Chi_Minh"), "Ho Chi Minh");
  assertEquals(zoneCity("Asia/Kolkata"), "Kolkata");
  // No "/" — the whole name is used as-is (decision: no lookup table,
  // no special-casing of "Etc/..." — see mig#15's PR body).
  assertEquals(zoneCity("UTC"), "UTC");
});

Deno.test("zoneOffsetLabel: whole hours, half hours, and zero", () => {
  const instant = zonedDateTime("2026-10-06", "09:00", "Asia/Ho_Chi_Minh");
  assertEquals(zoneOffsetLabel("Asia/Ho_Chi_Minh", instant), "UTC+7");
  assertEquals(zoneOffsetLabel("America/New_York", instant), "UTC-4");
  assertEquals(zoneOffsetLabel("Asia/Kolkata", instant), "UTC+5:30");
  // London in January is standard time — UTC+0, not omitted (decision:
  // zero always renders as "UTC+0", never a bare "UTC", so a real city
  // at zero offset still gets an explicit sign).
  const winter = zonedDateTime("2026-01-15", "09:00", "Europe/London");
  assertEquals(zoneOffsetLabel("Europe/London", winter), "UTC+0");
});

Deno.test("formatClockAt: HH:MM, City, UTC±N in each zone under test", () => {
  // 09:00 in Ho Chi Minh is 02:00 UTC.
  const instant = zonedDateTime("2026-10-06", "09:00", "Asia/Ho_Chi_Minh");
  assertEquals(
    formatClockAt(instant, "Asia/Ho_Chi_Minh"),
    "09:00, Ho Chi Minh, UTC+7",
  );
  assertEquals(
    formatClockAt(instant, "America/New_York"),
    "22:00, New York, UTC-4",
  );
  assertEquals(
    formatClockAt(instant, "Asia/Kolkata"),
    "07:30, Kolkata, UTC+5:30",
  );
  // Decision: a bare zone with no city segment renders "HH:MM, UTC" —
  // no redundant "UTC+0" alongside a name that already means zero.
  assertEquals(formatClockAt(instant, "UTC"), "02:00, UTC");
});

Deno.test("formatClockAt: an invalid zone falls back to the host's, via validTimeZoneOr", () => {
  // The server never formats an invalid zone directly — every caller
  // resolves it through validTimeZoneOr first (routes/embed/index.tsx,
  // ConfirmedView.tsx, routes/cancel.tsx). This pins that the fallback
  // then formats identically to a booking with no guest zone at all.
  const instant = zonedDateTime("2026-10-06", "09:00", "Asia/Ho_Chi_Minh");
  const resolved = validTimeZoneOr("Not/A_Timezone", "Asia/Ho_Chi_Minh");
  assertEquals(resolved, "Asia/Ho_Chi_Minh");
  assertEquals(
    formatClockAt(instant, resolved),
    "09:00, Ho Chi Minh, UTC+7",
  );
});

Deno.test("formatDateLong + formatTimeOfDay convert host-local wall clock into the display zone", () => {
  // mig#15's exact example: a 09:00 Tuesday slot in Ho Chi Minh is
  // 22:00 Monday in New York — the date moves, not just the time.
  const date = "2026-10-06"; // Tuesday
  const time = "09:00";
  const hostTz = "Asia/Ho_Chi_Minh";
  const displayTz = "America/New_York";

  assertEquals(
    formatDateLong(date, time, hostTz, displayTz),
    "Monday, 5 October 2026",
  );
  assertEquals(
    formatTimeOfDay(date, time, hostTz, displayTz),
    "22:00, New York, UTC-4",
  );

  // Same zone both sides (the host viewing their own booking) is
  // unaffected — this is the pre-mig#15 behaviour, still correct.
  assertEquals(
    formatDateLong(date, time, hostTz, hostTz),
    "Tuesday, 6 October 2026",
  );
  assertEquals(
    formatTimeOfDay(date, time, hostTz, hostTz),
    "09:00, Ho Chi Minh, UTC+7",
  );
});
