import { assertEquals, assertThrows } from "@std/assert";
import {
  _internals,
  getSlotsForDate,
  parseBlockedDates,
  parseWeeklyAvailability,
} from "../lib/availability.ts";

Deno.test("parseWeeklyAvailability — single day", () => {
  const a = parseWeeklyAvailability("MON 09:00-17:00");
  assertEquals(a.MON, [{ startMin: 540, endMin: 1020 }]);
  assertEquals(a.TUE, []);
});

Deno.test("parseWeeklyAvailability — day range", () => {
  const a = parseWeeklyAvailability("MON-FRI 09:00-17:00");
  for (const d of ["MON", "TUE", "WED", "THU", "FRI"]) {
    assertEquals(a[d as keyof typeof a], [{ startMin: 540, endMin: 1020 }]);
  }
  assertEquals(a.SAT, []);
  assertEquals(a.SUN, []);
});

Deno.test("parseWeeklyAvailability — split with comma", () => {
  const a = parseWeeklyAvailability(
    "MON-FRI 09:00-12:00, MON-FRI 14:00-18:00",
  );
  for (const d of ["MON", "TUE", "WED", "THU", "FRI"]) {
    assertEquals(a[d as keyof typeof a], [
      { startMin: 540, endMin: 720 },
      { startMin: 840, endMin: 1080 },
    ]);
  }
});

Deno.test("parseWeeklyAvailability — mixed per-day", () => {
  const a = parseWeeklyAvailability(
    "MON-THU 10:00-20:00,FRI 09:00-15:00",
  );
  assertEquals(a.MON, [{ startMin: 600, endMin: 1200 }]);
  assertEquals(a.FRI, [{ startMin: 540, endMin: 900 }]);
});

Deno.test("parseWeeklyAvailability — bad day throws, naming the position not the day", () => {
  let err = "";
  try {
    parseWeeklyAvailability("FOO 09:00-17:00");
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(err, "entry 1: unknown day");
});

Deno.test("parseWeeklyAvailability — backwards day range throws, naming the position", () => {
  let err = "";
  try {
    parseWeeklyAvailability("FRI-MON 09:00-17:00");
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(err, "entry 1: day range goes backwards");
});

Deno.test("parseWeeklyAvailability — end before start throws, naming the position", () => {
  let err = "";
  try {
    parseWeeklyAvailability("MON 17:00-09:00");
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(err, "entry 1: end time must be after start time");
});

Deno.test("parseWeeklyAvailability — equal start and end throws the same reason", () => {
  let err = "";
  try {
    parseWeeklyAvailability("MON 09:00-09:00");
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(err, "entry 1: end time must be after start time");
});

Deno.test("parseWeeklyAvailability — bad time throws, naming the position", () => {
  let err = "";
  try {
    parseWeeklyAvailability("MON 9am-5pm");
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(err, 'entry 1: invalid, expected e.g. "MON-FRI 09:00-17:00"');
});

Deno.test("parseWeeklyAvailability — bad entry at position 2 is named by position", () => {
  let err = "";
  try {
    parseWeeklyAvailability("MON 09:00-17:00, FOO 09:00-17:00");
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(err, "entry 2: unknown day");
});

Deno.test("parseWeeklyAvailability — empty value throws without a position", () => {
  let err = "";
  try {
    parseWeeklyAvailability("   ");
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(err, "is empty");
});

Deno.test("parseBlockedDates — single dates ISO", () => {
  const b = parseBlockedDates("2026-12-24,2026-12-25");
  assertEquals(b.has("2026-12-24"), true);
  assertEquals(b.has("2026-12-25"), true);
  assertEquals(b.size, 2);
});

Deno.test("parseBlockedDates — single dates European", () => {
  const b = parseBlockedDates("24.12.2026,25.12.2026");
  assertEquals(b.has("2026-12-24"), true);
  assertEquals(b.has("2026-12-25"), true);
});

Deno.test("parseBlockedDates — range ISO with ..", () => {
  const b = parseBlockedDates("2026-12-24..2026-12-26");
  assertEquals(b.size, 3);
  assertEquals(b.has("2026-12-24"), true);
  assertEquals(b.has("2026-12-25"), true);
  assertEquals(b.has("2026-12-26"), true);
});

Deno.test("parseBlockedDates — range European with -", () => {
  const b = parseBlockedDates("01.01.2027-10.01.2027");
  assertEquals(b.size, 10);
  assertEquals(b.has("2027-01-01"), true);
  assertEquals(b.has("2027-01-10"), true);
  assertEquals(b.has("2027-01-11"), false);
});

Deno.test("parseBlockedDates — mix", () => {
  const b = parseBlockedDates("01.01.2027-10.01.2027,04.07.2027");
  assertEquals(b.has("2027-01-01"), true);
  assertEquals(b.has("2027-01-10"), true);
  assertEquals(b.has("2027-07-04"), true);
  assertEquals(b.size, 11);
});

Deno.test("parseBlockedDates — empty string yields empty set", () => {
  assertEquals(parseBlockedDates("").size, 0);
  assertEquals(parseBlockedDates("   ").size, 0);
});

Deno.test("parseBlockedDates — bad date throws, naming the position not the value", () => {
  let err = "";
  try {
    parseBlockedDates("not-a-date");
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(
    err,
    "entry 1: invalid, expected YYYY-MM-DD, DD.MM.YYYY or a range like " +
      "2026-12-24..2026-12-31",
  );
});

Deno.test("parseBlockedDates — bad entry at position 3 is named by position", () => {
  let err = "";
  try {
    parseBlockedDates("2026-12-24,2026-12-25,not-a-date");
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(err.startsWith("entry 3:"), true);
});

Deno.test("parseBlockedDates — bad range throws, naming the position", () => {
  let err = "";
  try {
    parseBlockedDates("2026-12-24,2026-12-25,2026-12-24..bad..2026-12-26");
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(
    err,
    'entry 3: invalid range, expected two dates joined with ".."',
  );
});

// mig#38 round 2 follow-up: expandDateRange (via addDays) runs Intl-backed
// tz math against `hostTz` — only reachable when the value is a *range*
// (a plain list of single dates never calls it). An invalid `hostTz`
// makes that throw its own foreign error (V8: "Invalid time zone
// specified: <value>"), which embeds the raw value. This calls
// parseBlockedDates directly (unlike lib/config.test.ts's child-process
// route, which can no longer reach this because HOST_TZ is validated
// first there) to pin the FieldSyntaxError guard in isolation: even with
// a bad `hostTz`, the thrown message must stay value-free.
Deno.test("parseBlockedDates — an invalid hostTz on a range throws a value-free reason, not Intl's own message", () => {
  const marker = "HOSTTZ-DIRECT-MARKER-9pj4";
  let err = "";
  try {
    parseBlockedDates("2026-12-24..2026-12-26", `Not/A/Real/Zone-${marker}`);
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(err, "entry 1: could not be evaluated — check HOST_TZ");
  assertEquals(
    err.includes(marker),
    false,
    `error echoed the bad hostTz:\n${err}`,
  );
});

// parseWeeklyAvailability's own checks (parseAvailabilityEntry, parseHHMM,
// expandDayRange) never call Intl or anything else that could throw a
// foreign, value-carrying error — every throw on that path is already a
// FieldSyntaxError raised directly by this module. There is currently no
// input that reaches the `: "could not be evaluated"` fallback in
// parseWeeklyAvailability's catch, so there's no equivalent standalone
// test to pin here; the fallback exists only as a guard against a future
// change (e.g. a day-name lookup added later that calls Intl).

// mig#38 round 2: position counting must count every comma-split field,
// including the ones that are empty after trimming — a parser that first
// filters out empties and only then indexes would misreport the position
// here.
Deno.test("parseWeeklyAvailability — an empty field still counts toward position", () => {
  let err = "";
  try {
    parseWeeklyAvailability("MON 09:00-17:00, ,TUE bad");
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(err.startsWith("entry 3:"), true);
});

Deno.test("parseWeeklyAvailability — a trailing comma is ignored, not a phantom entry", () => {
  const a = parseWeeklyAvailability("MON 09:00-17:00,");
  assertEquals(a.MON, [{ startMin: 540, endMin: 1020 }]);
});

Deno.test("parseBlockedDates — an empty field still counts toward position", () => {
  let err = "";
  try {
    parseBlockedDates("2026-12-24,,not-a-date");
  } catch (e) {
    err = (e as Error).message;
  }
  assertEquals(err.startsWith("entry 3:"), true);
});

Deno.test("parseBlockedDates — a trailing comma is ignored, not a phantom entry", () => {
  const b = parseBlockedDates("2026-12-24,");
  assertEquals(b.size, 1);
  assertEquals(b.has("2026-12-24"), true);
});

// mig#38 round 2: parseHHMM's malformed-format branch (the `if (!m)`
// check) is unreachable through the public API — parseAvailabilityEntry's
// own regex already guarantees the \d{1,2}:\d{2} shape before either time
// string reaches parseHHMM. Exercised directly via `_internals` so the
// branch still has coverage instead of being silently dead.
Deno.test("_internals.parseHHMM — malformed format throws, value-free", () => {
  const err = assertThrows(() => _internals.parseHHMM("9am"));
  assertEquals((err as Error).message, "bad time, expected HH:MM");
});

// mig#57: @spy4x/time/tz's zonedDateTime moves a spring-forward gap
// time forward (Berlin's 02:30 on 2027-03-28 becomes 03:30), so a
// 02:00 or 02:30 slot would duplicate the real 03:00 and 03:30 ones.
// 2027-03-28 is a Sunday; Berlin's clocks jump from 02:00 to 03:00.
Deno.test("getSlotsForDate — a slot inside the spring-forward gap is not offered", () => {
  const slots = getSlotsForDate(
    "2027-03-28",
    parseWeeklyAvailability("SUN 01:00-04:00"),
    30,
    [],
    "Europe/Berlin",
    new Date(0),
  );

  assertEquals(slots.map((s) => s.time), ["01:00", "01:30", "03:00", "03:30"]);
});

// mig#57: "2026-02-30" used to be kept as a blocked date that could
// never match (single) or reported as a HOST_TZ problem (range, via
// addDays' RangeError); both now name the entry.
Deno.test("parseBlockedDates — a date that is not on the calendar throws, naming the position", () => {
  for (const value of ["2026-02-30", "30.02.2026", "2026-02-27..2026-02-30"]) {
    let err = "";
    try {
      parseBlockedDates(`2026-12-24,${value}`, "Europe/Berlin");
    } catch (e) {
      err = (e as Error).message;
    }
    assertEquals(err, "entry 2: not a real calendar date", value);
  }
});
