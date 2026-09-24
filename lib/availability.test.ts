import { assertEquals, assertThrows } from "@std/assert";
import {
  _internals,
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
