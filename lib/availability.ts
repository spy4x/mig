// Weekly availability + blocked dates parsing.
//
// WEEKLY_AVAILABILITY syntax (comma-separated):
//   MON-FRI 09:00-17:00
//   MON-FRI 09:00-12:00, MON-FRI 14:00-18:00
//   MON 09:00-12:00, TUE-WED 14:00-18:00, FRI 09:00-15:00
//
// BLOCKED_DATES syntax (comma-separated):
//   2026-12-24, 2026-12-25, 2026-12-26          (single dates, ISO)
//   01.01.2027-10.01.2027                      (range, DD.MM.YYYY)
//   01.01.2027-10.01.2027, 04.07.2027         (mix)
//   2026-12-24..2026-12-26                     (range, ISO, ..)
// Range inclusive both ends.

import type { Availability, DayOfWeek } from "./types.ts";
import { addDays, minToHHMM, zonedDateTime } from "./tz.ts";

const DAYS: DayOfWeek[] = [
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
];

/** Thrown by parseWeeklyAvailability/parseBlockedDates on bad syntax.
 *  `index` is the 1-based position of the offending entry, exactly as the
 *  caller's `s.split(",")` produces it — 0 when the problem isn't about one
 *  entry (e.g. the whole value is empty). `reason` never repeats the raw
 *  value: these startup errors land in container logs (mig#38), so the
 *  message names the shape that was expected instead of echoing what was
 *  typed. config.ts prints `.message` straight through. */
export class ConfigSyntaxError extends Error {
  constructor(public readonly index: number, public readonly reason: string) {
    super(index > 0 ? `entry ${index}: ${reason}` : reason);
  }
}

/** Thrown only by this module's own syntax checks — the ones raised
 *  directly by parseAvailabilityEntry/parseHHMM/expandDayRange
 *  (WEEKLY_AVAILABILITY) and parseDateToken/parseSingleDate
 *  (BLOCKED_DATES). Never by the Intl-backed tz math `expandDateRange`
 *  (via `addDays`) calls into — which, given an invalid `hostTz`, throws
 *  its own *foreign* error carrying the raw value (V8: "Invalid time
 *  zone specified: <value>"). HOST_TZ is validated on its own, before
 *  either of these run (lib/config.ts), and named there — never here.
 *  parseWeeklyAvailability/parseBlockedDates below only forward a
 *  caught error's `.message` when it's one of these; anything else
 *  (mig#38 round 2) becomes a fixed, value-free reason instead, so a
 *  foreign message can never pass through as if it were one of ours. */
class FieldSyntaxError extends Error {}

function parseHHMM(s: string): number {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  // Unreachable through the public API today: parseAvailabilityEntry's
  // own regex already requires \d{1,2}:\d{2} before either time string
  // reaches here, so `m` is never null in practice. Kept (rather than a
  // non-null assertion) as a guard against that invariant breaking if
  // the caller's regex ever changes; covered directly via `_internals`
  // in lib/availability.test.ts since the public route can't reach it.
  if (!m) throw new FieldSyntaxError("bad time, expected HH:MM");
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 24 || min < 0 || min > 59) {
    throw new FieldSyntaxError("time out of range (hour 0-24, minute 0-59)");
  }
  if (h === 24 && min !== 0) {
    throw new FieldSyntaxError("24:00 must be exact, no other minutes allowed");
  }
  return h * 60 + min;
}

function expandDayRange(start: string, end: string): DayOfWeek[] {
  const a = DAYS.indexOf(start as DayOfWeek);
  const b = DAYS.indexOf(end as DayOfWeek);
  if (a === -1 || b === -1) throw new FieldSyntaxError("unknown day");
  if (b < a) {
    throw new FieldSyntaxError("day range goes backwards");
  }
  return DAYS.slice(a, b + 1);
}

/** Parses one "DAY[-DAY] HH:MM-HH:MM" entry. Throws a `FieldSyntaxError`
 *  — the caller (parseWeeklyAvailability) wraps it with the entry's
 *  position. */
function parseAvailabilityEntry(entry: string): {
  dayNames: DayOfWeek[];
  startMin: number;
  endMin: number;
} {
  const m = entry.match(
    /^([A-Z]{3}(?:-[A-Z]{3})?)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/,
  );
  if (!m) {
    throw new FieldSyntaxError('invalid, expected e.g. "MON-FRI 09:00-17:00"');
  }
  const [, dayPart, startStr, endStr] = m;
  const startMin = parseHHMM(startStr);
  const endMin = parseHHMM(endStr);
  if (endMin <= startMin) {
    throw new FieldSyntaxError("end time must be after start time");
  }

  let dayNames: DayOfWeek[];
  if (dayPart.includes("-")) {
    const [a, b] = dayPart.split("-");
    dayNames = expandDayRange(a, b);
  } else {
    if (!(DAYS as readonly string[]).includes(dayPart)) {
      throw new FieldSyntaxError("unknown day");
    }
    dayNames = [dayPart as DayOfWeek];
  }

  return { dayNames, startMin, endMin };
}

export function parseWeeklyAvailability(s: string): Availability {
  const out: Availability = {
    MON: [],
    TUE: [],
    WED: [],
    THU: [],
    FRI: [],
    SAT: [],
    SUN: [],
  };

  if (!s.trim()) {
    throw new ConfigSyntaxError(0, "is empty");
  }

  const rawEntries = s.split(",");
  for (let i = 0; i < rawEntries.length; i++) {
    const entry = rawEntries[i].trim();
    if (!entry) continue;
    const position = i + 1;

    try {
      const { dayNames, startMin, endMin } = parseAvailabilityEntry(entry);
      for (const d of dayNames) {
        out[d].push({ startMin, endMin });
      }
    } catch (e) {
      const reason = e instanceof FieldSyntaxError
        ? e.message
        : "could not be evaluated";
      throw new ConfigSyntaxError(position, reason);
    }
  }

  // Sort + sanity: any day with at least one range is fine; otherwise
  // caller decides if "no availability at all" is a problem (it isn't —
  // it just means the picker shows the empty state).
  for (const d of DAYS) {
    out[d].sort((a, b) => a.startMin - b.startMin);
  }

  return out;
}

// Parses a single date or range token. Supports:
//   YYYY-MM-DD                      single, ISO
//   DD.MM.YYYY                      single, European
//   YYYY-MM-DD..YYYY-MM-DD          range, ISO
//   DD.MM.YYYY-DD.MM.YYYY           range, European (split on `-`)
//   YYYY-MM-DD-YYYY-MM-DD           range, ISO (split on `-`)
//
// Strategy:
//   1. If exact match for YYYY-MM-DD or DD.MM.YYYY → single.
//   2. If contains ".." → range on "..".
//   3. Else split on "-". If both halves parse as a date → range.
//   4. Else → error.
function parseDateToken(tok: string, hostTz: string): string[] {
  const t = tok.trim();
  if (!t) return [];

  // Step 1: exact single-date form?
  if (isSingleDateShape(t)) {
    return [parseSingleDate(t)];
  }

  // Step 2: ".." range
  if (t.includes("..")) {
    const parts = t.split("..").map((p) => p.trim());
    if (parts.length !== 2) {
      throw new FieldSyntaxError(
        'invalid range, expected two dates joined with ".."',
      );
    }
    const [a, b] = parts.map(parseSingleDate).sort();
    return expandDateRange(a, b, hostTz);
  }

  // Step 3: "-" range (halves are themselves dates)
  if (t.includes("-")) {
    const parts = t.split("-");
    // ISO range: "2026-12-24-2026-12-26" → 6 parts (2 per date × 2 dates)
    // European range: "01.01.2027-10.01.2027" → 2 parts (1 separator)
    let halves: [string, string] | null = null;
    if (parts.length === 6) {
      halves = [parts.slice(0, 3).join("-"), parts.slice(3).join("-")];
    } else if (parts.length === 2) {
      halves = [parts[0], parts[1]];
    }
    if (halves && halves.every(isSingleDateShape)) {
      const [d1, d2] = halves.map(parseSingleDate).sort();
      return expandDateRange(d1, d2, hostTz);
    }
  }

  throw new FieldSyntaxError(
    "invalid, expected YYYY-MM-DD, DD.MM.YYYY or a range like " +
      "2026-12-24..2026-12-31",
  );
}

function isSingleDateShape(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) || /^\d{2}\.\d{2}\.\d{4}$/.test(s);
}

function expandDateRange(a: string, b: string, hostTz: string): string[] {
  const out: string[] = [];
  let cur = a;
  let safety = 400;
  while (cur <= b && safety-- > 0) {
    out.push(cur);
    cur = addDays(cur, 1, hostTz);
  }
  return out;
}

function parseSingleDate(s: string): string {
  // YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD.MM.YYYY
  m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  throw new FieldSyntaxError("invalid, expected YYYY-MM-DD or DD.MM.YYYY");
}

export function parseBlockedDates(s: string, hostTz = "UTC"): Set<string> {
  const out = new Set<string>();
  if (!s || !s.trim()) return out;

  // Split on comma at top level only
  const tokens = s.split(",");
  for (let i = 0; i < tokens.length; i++) {
    const position = i + 1;
    try {
      for (const d of parseDateToken(tokens[i], hostTz)) {
        out.add(d);
      }
    } catch (e) {
      // expandDateRange (via addDays) runs Intl-backed tz math against
      // hostTz — given an invalid HOST_TZ, that throws its own *foreign*
      // error carrying the raw value (mig#38 round 2). Only a
      // FieldSyntaxError raised by this module's own token/date checks
      // is safe to forward; anything else collapses to a fixed,
      // value-free reason instead of ever risking that leak.
      const reason = e instanceof FieldSyntaxError
        ? e.message
        : "could not be evaluated — check HOST_TZ";
      throw new ConfigSyntaxError(position, reason);
    }
  }
  return out;
}

// Slot generation. Returns slot start times as HH:MM strings (host-local).
// `now` is passed in for testability.
export function getSlotsForDate(
  date: string,
  availability: Availability,
  slotMin: number,
  bookingsForDate: { time: string; status: "active" | "cancelled" }[],
  hostTz: string,
  minStartInstant: Date,
): { time: string; available: boolean }[] {
  const dayName = dayNameFromDate(date, hostTz);
  const ranges = availability[dayName];
  if (ranges.length === 0) return [];

  const booked = new Set(
    bookingsForDate.filter((b) => b.status === "active").map((b) => b.time),
  );
  const out: { time: string; available: boolean }[] = [];

  for (const range of ranges) {
    // Slots start at range.startMin, range.startMin + slotMin, ... up to
    // (range.endMin - slotMin) inclusive.
    const lastStart = range.endMin - slotMin;
    for (let m = range.startMin; m <= lastStart; m += slotMin) {
      const time = minToHHMM(m);
      const instant = zonedDateTime(date, time, hostTz);
      const available = !booked.has(time) && instant >= minStartInstant;
      out.push({ time, available });
    }
  }

  return out;
}

function dayNameFromDate(date: string, tz: string): DayOfWeek {
  // noon to avoid DST edge weirdness
  const dt = zonedDateTime(date, "12:00", tz);
  const w = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
  }).format(dt).toUpperCase();
  if (!DAYS.includes(w as DayOfWeek)) {
    throw new Error(`unexpected weekday "${w}" for ${date} ${tz}`);
  }
  return w as DayOfWeek;
}

// Count slots (excluding past) for a date — used to mark "Full" vs "8 slots"
// in the date picker.
export function countSlotsForDate(
  date: string,
  availability: Availability,
  slotMin: number,
  bookedCount: number,
  hostTz: string,
  minStartInstant: Date,
): number {
  const slots = getSlotsForDate(
    date,
    availability,
    slotMin,
    Array.from({ length: bookedCount }, () => ({
      time: "00:00",
      status: "active" as const,
    })),
    hostTz,
    minStartInstant,
  );
  return slots.filter((s) => s.available).length;
}

// Generate candidate booking dates within the horizon. Returns YYYY-MM-DD
// strings in order. Excludes dates with no availability or all blocked.
export function getCandidateDates(
  startDate: string,
  horizonDays: number,
  hostTz: string,
): string[] {
  const out: string[] = [];
  for (let i = 0; i <= horizonDays; i++) {
    out.push(addDays(startDate, i, hostTz));
  }
  return out;
}

// Convenience for tests. parseHHMM's malformed-format branch is
// unreachable through the public API (parseAvailabilityEntry's own regex
// already guarantees the \d{1,2}:\d{2} shape before either time string
// reaches parseHHMM) — this is the only way to exercise it directly.
export const _internals = {
  parseHHMM,
};
