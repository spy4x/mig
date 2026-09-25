import { assertEquals } from "@std/assert";
import { zonedDateTime } from "@spy4x/time/tz";
import {
  canonicalTimeZone,
  canonicalTimeZoneOr,
  canonicalValidTimeZoneOrNull,
  formatClockAt,
  formatClockShortAt,
  formatGridHeader,
  formatHostClockIn,
  formatHostDateIn,
  formatOwnerClock,
  formatShortDateAt,
  formatSlotDisplay,
  isCalendarDateTime,
  zoneCity,
  zoneOffsetLabel,
} from "./clock.ts";

// ─── mig#15: "HH:MM, City, UTC±N" formatter ──────────────────────────
// October 2026 is DST-unambiguous for both zones under test: New York
// is EDT (UTC-4) until 1 Nov 2026, and Ho Chi Minh has no DST at all
// (always UTC+7).

Deno.test("zoneCity: last path segment, underscores replaced by spaces", () => {
  assertEquals(zoneCity("America/New_York"), "New York");
  assertEquals(zoneCity("Asia/Ho_Chi_Minh"), "Ho Chi Minh");
  assertEquals(zoneCity("Asia/Kolkata"), "Kolkata");
  // No "/" — the whole name is used as-is (decision: no lookup table —
  // see mig#15's PR body). formatClockAt special-cases "Etc/*" itself
  // (offset-only, no city) rather than zoneCity, since "Etc/GMT+5"
  // still has a real (if not city-shaped) segment after the slash.
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

Deno.test("formatClockAt: an invalid zone falls back to the host's, via canonicalTimeZoneOr", () => {
  // The server never formats an invalid zone directly — every caller
  // resolves it through canonicalTimeZoneOr first (routes/embed/index.tsx,
  // ConfirmedView.tsx, routes/cancel.tsx). This pins that the fallback
  // then formats identically to a booking with no guest zone at all.
  const instant = zonedDateTime("2026-10-06", "09:00", "Asia/Ho_Chi_Minh");
  const resolved = canonicalTimeZoneOr("Not/A_Timezone", "Asia/Ho_Chi_Minh");
  assertEquals(resolved, "Asia/Ho_Chi_Minh");
  assertEquals(
    formatClockAt(instant, resolved),
    "09:00, Ho Chi Minh, UTC+7",
  );
});

Deno.test("formatHostDateIn + formatHostClockIn convert host-local wall clock into the display zone", () => {
  // mig#15's exact example: a 09:00 Tuesday slot in Ho Chi Minh is
  // 22:00 Monday in New York — the date moves, not just the time.
  const date = "2026-10-06"; // Tuesday
  const time = "09:00";
  const hostTz = "Asia/Ho_Chi_Minh";
  const displayTz = "America/New_York";

  assertEquals(
    formatHostDateIn(date, time, hostTz, displayTz),
    "Monday, 5 October 2026",
  );
  assertEquals(
    formatHostClockIn(date, time, hostTz, displayTz),
    "22:00, New York, UTC-4",
  );

  // Same zone both sides (the host viewing their own booking) is
  // unaffected — this is the pre-mig#15 behaviour, still correct.
  assertEquals(
    formatHostDateIn(date, time, hostTz, hostTz),
    "Tuesday, 6 October 2026",
  );
  assertEquals(
    formatHostClockIn(date, time, hostTz, hostTz),
    "09:00, Ho Chi Minh, UTC+7",
  );
});

// ─── mig#15 review: canonicalization ──────────────────────────────────
// Every one of these is a bug the reviewer actually saw before this
// fix: "11:00, Japan" (no offset — "Japan" has no "/" so it looked
// like a bare zone), "00:00, new york, UTC-4" (wrong case survived
// into the rendered city name), "00:00, GMT+5, UTC-5" (Etc/GMT+5's own
// segment isn't a city, and is confusingly sign-inverted from its
// actual offset).

Deno.test("canonicalTimeZone: fixes casing and slash-less aliases, never renames a valid modern zone", () => {
  assertEquals(canonicalTimeZone("japan"), "Asia/Tokyo");
  assertEquals(canonicalTimeZone("Japan"), "Asia/Tokyo");
  assertEquals(canonicalTimeZone("EST5EDT"), "America/New_York");
  assertEquals(canonicalTimeZone("america/new_york"), "America/New_York");
  // mig#15 round 2: routing every zone through Intl's resolvedOptions()
  // (round 1's approach) rewrote these four modern names to their
  // legacy backward-compat links under Deno's ICU — a real, visible
  // regression (a Ukrainian visitor saw "Kiev" everywhere) and an
  // unstable /embed redirect (a browser that itself reports the
  // modern name would never stop bouncing between the two spellings).
  // They must now survive canonicalization completely unchanged.
  assertEquals(canonicalTimeZone("Asia/Kolkata"), "Asia/Kolkata");
  assertEquals(canonicalTimeZone("Europe/Kyiv"), "Europe/Kyiv");
  assertEquals(canonicalTimeZone("Asia/Ho_Chi_Minh"), "Asia/Ho_Chi_Minh");
  assertEquals(canonicalTimeZone("Asia/Kathmandu"), "Asia/Kathmandu");
  // A zone with a "/" that Intl.supportedValuesOf's curated list
  // doesn't contain in any casing (case-insensitive match fails) is
  // left exactly as given — the rule is "fix casing where a match
  // exists", not "resolve every alias with a slash".
  assertEquals(canonicalTimeZone("US/Eastern"), "US/Eastern");
});

// mig#18: the README claimed "a valid name with the wrong casing has
// its casing fixed" unconditionally, which was false for any zone
// Intl.supportedValuesOf omits entirely — "Etc/GMT+5" kept its input
// casing, and "etc/gmt+5" then rendered "gmt+5" as if it were a city
// (formatClockAt's "Etc/" check was case-sensitive). This pins the
// corrected rule: casing is fixed against the curated list first,
// then against resolvedOptions() but only when that's the *same* name
// differently cased — never when it would rename to a legacy alias.
Deno.test("canonicalTimeZone: fixes Etc/* casing via resolvedOptions when it's a same-name match", () => {
  assertEquals(canonicalTimeZone("etc/gmt+5"), "Etc/GMT+5");
  assertEquals(canonicalTimeZone("ETC/GMT+5"), "Etc/GMT+5");
  assertEquals(canonicalTimeZone("Etc/gmt+5"), "Etc/GMT+5");
});

Deno.test("canonicalTimeZone: a name resolvedOptions() would rename to a different (legacy) name stays as sent, uncorrected", () => {
  // "Asia/Ho_Chi_Minh" isn't in Intl.supportedValuesOf's curated list
  // at all on Deno's ICU, and resolvedOptions() resolves it to the
  // legacy "Asia/Saigon" — a different name, not just different
  // casing — so the guard must reject that answer and keep the input.
  assertEquals(canonicalTimeZone("asia/ho_chi_minh"), "asia/ho_chi_minh");
  assertEquals(canonicalTimeZone("Asia/Kolkata"), "Asia/Kolkata");
  assertEquals(canonicalTimeZone("Europe/Kyiv"), "Europe/Kyiv");
});

Deno.test("formatClockAt: an Etc/* zone shows the offset only, never a city, regardless of its casing", () => {
  const instant = zonedDateTime("2026-10-06", "09:00", "Asia/Ho_Chi_Minh");
  // Uncanonicalized, lower-cased input — formatClockAt must not rely
  // on the caller having fixed the casing first.
  assertEquals(formatClockAt(instant, "etc/gmt+5"), "21:00, UTC-5");
  assertEquals(
    formatClockAt(instant, canonicalTimeZone("etc/gmt+5")),
    "21:00, UTC-5",
  );
});

Deno.test("canonicalValidTimeZoneOrNull: null for missing or invalid, canonical otherwise", () => {
  assertEquals(canonicalValidTimeZoneOrNull(undefined), null);
  assertEquals(canonicalValidTimeZoneOrNull(null), null);
  assertEquals(canonicalValidTimeZoneOrNull(""), null);
  assertEquals(canonicalValidTimeZoneOrNull("Not/A_Timezone"), null);
  assertEquals(canonicalValidTimeZoneOrNull("Japan"), "Asia/Tokyo");
});

Deno.test("formatClockAt: a legacy alias only gets its offset once canonicalized", () => {
  const instant = zonedDateTime("2026-10-06", "09:00", "Asia/Ho_Chi_Minh");
  // "Japan" itself has no "/", so formatClockAt alone would (wrongly)
  // treat it as a bare, offset-less zone — canonicalizing first is
  // what makes the offset appear.
  assertEquals(formatClockAt(instant, "Japan"), "11:00, Japan");
  assertEquals(
    formatClockAt(instant, canonicalTimeZone("Japan")),
    "11:00, Tokyo, UTC+9",
  );
});

Deno.test("formatClockAt: Etc/* zones show the offset only, never their own confusing segment as a city", () => {
  const instant = zonedDateTime("2026-10-06", "09:00", "Asia/Ho_Chi_Minh");
  // Etc/GMT+5 means UTC-5 (POSIX sign convention is inverted from the
  // everyday one) — "10:00, GMT+5, UTC-5" would show two different,
  // contradictory signs for the same zone.
  assertEquals(formatClockAt(instant, "Etc/GMT+5"), "21:00, UTC-5");
  // "Etc/*" zones have a "/", so canonicalization (round 2) leaves
  // them exactly as given rather than resolving them — formatClockAt's
  // own Etc/* branch (above) is what keeps the output sane either way.
  assertEquals(canonicalTimeZone("Etc/UTC"), "Etc/UTC");
});

Deno.test("formatShortDateAt + formatClockShortAt: short dated forms used in subjects and NTFY", () => {
  const instant = zonedDateTime("2026-10-06", "09:00", "Asia/Ho_Chi_Minh");
  assertEquals(formatShortDateAt(instant, "Asia/Ho_Chi_Minh"), "Tue 6 Oct");
  assertEquals(formatShortDateAt(instant, "America/New_York"), "Mon 5 Oct");
  assertEquals(
    formatClockShortAt(instant, "Asia/Ho_Chi_Minh"),
    "Tue 6 Oct 09:00, Ho Chi Minh, UTC+7",
  );
});

Deno.test("formatOwnerClock: adds the visitor's date only when it differs from the host's", () => {
  // Cross-midnight pair (dates differ) — the exact example from the
  // issue and the reviewer's follow-up.
  assertEquals(
    formatOwnerClock(
      "2026-10-06",
      "09:00",
      "Asia/Ho_Chi_Minh",
      "America/New_York",
    ),
    "Tue 6 Oct 09:00, Ho Chi Minh, UTC+7 (visitor: Mon 5 Oct 22:00, New York, UTC-4)",
  );
  // Same calendar day both sides — the visitor's own date would be
  // redundant, so only their time+zone shows.
  assertEquals(
    formatOwnerClock(
      "2026-10-06",
      "16:00",
      "Asia/Ho_Chi_Minh",
      "America/New_York",
    ),
    "Tue 6 Oct 16:00, Ho Chi Minh, UTC+7 (visitor: 05:00, New York, UTC-4)",
  );
  // No visitor zone known — host clock alone, never a guess.
  assertEquals(
    formatOwnerClock("2026-10-06", "09:00", "Asia/Ho_Chi_Minh", undefined),
    "Tue 6 Oct 09:00, Ho Chi Minh, UTC+7",
  );
  // Long form for email bodies.
  assertEquals(
    formatOwnerClock(
      "2026-10-06",
      "09:00",
      "Asia/Ho_Chi_Minh",
      "America/New_York",
      true,
    ),
    "Tuesday, 6 October 2026 at 09:00, Ho Chi Minh, UTC+7 " +
      "(visitor: Monday, 5 October 2026 at 22:00, New York, UTC-4)",
  );
});

// ─── formatSlotDisplay (mig#48 review) ────────────────────────────────

Deno.test("formatSlotDisplay: a slot whose own offset matches the header's omits offsetNote", () => {
  const instant = new Date("2026-10-06T02:00:00Z"); // 09:00 Ho Chi Minh, UTC+7
  const display = formatSlotDisplay(instant, "Asia/Ho_Chi_Minh", "UTC+7");
  assertEquals(display.hhmm, "09:00");
  assertEquals(display.ariaZoneLabel, "Ho Chi Minh, UTC+7");
  assertEquals(display.offsetNote, undefined);
});

Deno.test("formatSlotDisplay: a slot whose own offset differs from the header's sets offsetNote", () => {
  const instant = new Date("2026-10-06T02:00:00Z"); // 09:00 Ho Chi Minh, UTC+7
  const display = formatSlotDisplay(instant, "Asia/Ho_Chi_Minh", "UTC+8");
  assertEquals(display.offsetNote, "UTC+7");
});

Deno.test("formatSlotDisplay: a zone with no city (UTC) still compares by offset", () => {
  const instant = new Date("2026-10-06T02:00:00Z");
  const matching = formatSlotDisplay(instant, "UTC", "UTC+0");
  assertEquals(matching.hhmm, "02:00");
  assertEquals(matching.ariaZoneLabel, "UTC");
  assertEquals(matching.offsetNote, undefined);
  const differing = formatSlotDisplay(instant, "UTC", "UTC+1");
  assertEquals(differing.offsetNote, "UTC+0");
});

// ─── formatGridHeader (mig#48 review) ─────────────────────────────────

Deno.test("formatGridHeader: label and offset come from the first instant, even when a later one has a different offset", () => {
  // America/New_York's DST ends 2026-11-01 at 06:00 UTC (02:00 EDT ->
  // 01:00 EST) — `first` is 5 minutes before that, still UTC-4;
  // `later` is 3 hours after, already UTC-5. Taking the LAST instant
  // instead of the first (a plausible off-by-one) would return UTC-5
  // here, so this only passes when the FIRST instant actually wins.
  const first = new Date("2026-11-01T05:00:00Z"); // 01:00 New York, UTC-4
  const later = new Date("2026-11-01T08:00:00Z"); // 03:00 New York, UTC-5
  assertEquals(
    formatGridHeader([first, later], "America/New_York"),
    { label: "New York, UTC-4", offset: "UTC-4" },
  );
});

Deno.test("formatGridHeader: null when there are no instants to derive a header from", () => {
  assertEquals(formatGridHeader([], "Asia/Ho_Chi_Minh"), null);
});

// ─── isCalendarDateTime (mig#57) ──────────────────────────────────────

// New York ran on UTC-4:56:02 until 1883. The calendar has 1800-06-01,
// but @spy4x/time/tz's zonedDateTime has no minute-exact instant for
// its noon in New York, so the zone-aware check refuses it.
Deno.test("isCalendarDateTime: with a zone, refuses a wall clock the zone cannot resolve to the minute", () => {
  assertEquals(isCalendarDateTime("1800-06-01", "12:00"), true);
  assertEquals(
    isCalendarDateTime("1800-06-01", "12:00", "America/New_York"),
    false,
  );
  assertEquals(
    isCalendarDateTime("2026-06-01", "12:00", "America/New_York"),
    true,
  );
});
