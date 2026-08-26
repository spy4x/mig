import { assertEquals, assertExists } from "@std/assert";
import {
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

Deno.test("parseWeeklyAvailability — bad day throws", () => {
  let err = "";
  try {
    parseWeeklyAvailability("FOO 09:00-17:00");
  } catch (e) {
    err = (e as Error).message;
  }
  assertExists(err);
  assertEquals(err.includes("FOO"), true);
});

Deno.test("parseWeeklyAvailability — backwards day range throws", () => {
  let err = "";
  try {
    parseWeeklyAvailability("FRI-MON 09:00-17:00");
  } catch (e) {
    err = (e as Error).message;
  }
  assertExists(err);
});

Deno.test("parseWeeklyAvailability — end before start throws", () => {
  let err = "";
  try {
    parseWeeklyAvailability("MON 17:00-09:00");
  } catch (e) {
    err = (e as Error).message;
  }
  assertExists(err);
});

Deno.test("parseWeeklyAvailability — bad time throws", () => {
  let err = "";
  try {
    parseWeeklyAvailability("MON 9am-5pm");
  } catch (e) {
    err = (e as Error).message;
  }
  assertExists(err);
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

Deno.test("parseBlockedDates — bad date throws", () => {
  let err = "";
  try {
    parseBlockedDates("not-a-date");
  } catch (e) {
    err = (e as Error).message;
  }
  assertExists(err);
});
