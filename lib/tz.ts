// IANA timezone helpers. All host-side date/time math runs in HOST_TZ;
// client-side strings are pre-formatted by the browser Intl APIs.

// Format an ISO date (YYYY-MM-DD) and time (HH:MM) interpreted in `tz`
// as a long human-readable string. Examples:
//   "Wednesday, 28 August 2026, 10:00"
export function formatDateTimeLong(
  date: string,
  time: string,
  tz: string,
): string {
  const dt = zonedDateTime(date, time, tz);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dt);
}

// Short form used in emails subject lines + buttons. Examples:
//   "Wed 28 Aug, 10:00"
export function formatDateTimeShort(
  date: string,
  time: string,
  tz: string,
): string {
  const dt = zonedDateTime(date, time, tz);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // "Wed, 28 Aug, 10:00" — strip the comma after weekday
  return fmt.format(dt).replace(/^([^,]+),/, "$1");
}

// YYYY-MM-DD for today in the given tz.
export function todayInTz(tz: string): string {
  return isoDateInTz(new Date(), tz);
}

// YYYY-MM-DD for a Date object in the given tz.
export function isoDateInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${day}`;
}

// HH:MM for a Date object in the given tz.
export function hhmmInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")!.value;
  const m = parts.find((p) => p.type === "minute")!.value;
  return `${h}:${m}`;
}

// Build a Date that represents wall-clock YYYY-MM-DD HH:MM in the given tz.
// Returns the corresponding UTC instant. This is the inverse of
// `formatDateTimeLong`: given a date+time pair, find the UTC ms.
export function zonedDateTime(date: string, time: string, tz: string): Date {
  // First guess: treat the wall clock as UTC, then adjust by tz offset.
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, 0, 0);

  // Find the tz offset at that instant, in minutes.
  const offsetMin = tzOffsetMinutes(new Date(naiveUtc), tz);

  // The correct UTC instant = naive - offset.
  return new Date(naiveUtc - offsetMin * 60_000);
}

// Minutes east of UTC for `tz` at the given instant. Positive east.
// Uses the standard `Intl.DateTimeFormat` offset trick.
export function tzOffsetMinutes(d: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  });
  const parts = fmt.formatToParts(d);
  const tzn = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  // Examples: "GMT+1", "GMT-5", "GMT+5:30", "GMT" (=0)
  const m = tzn.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  const hh = parseInt(m[2], 10);
  const mm = parseInt(m[3] ?? "0", 10);
  return sign * (hh * 60 + mm);
}

// Day of week name (Mon..Sun) for a YYYY-MM-DD in tz.
export function dayOfWeek(date: string, tz: string): string {
  const dt = zonedDateTime(date, "12:00", tz); // noon avoids DST edges
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
  }).format(dt).toUpperCase();
}

// Add `n` days to a YYYY-MM-DD string, return new YYYY-MM-DD.
// Day arithmetic is done in tz to avoid DST drift.
export function addDays(date: string, n: number, tz: string): string {
  const dt = zonedDateTime(date, "12:00", tz);
  dt.setUTCDate(dt.getUTCDate() + n);
  return isoDateInTz(dt, tz);
}

// Minutes-since-midnight to "HH:MM" zero-padded.
export function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
