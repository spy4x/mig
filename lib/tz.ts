// IANA timezone helpers. All host-side date/time math runs in HOST_TZ;
// client-side strings are pre-formatted by the browser Intl APIs.

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function validTimeZoneOr(
  value: string | undefined,
  fallback: string,
): string {
  return value && isValidTimeZone(value) ? value : fallback;
}

// Format an ISO date (YYYY-MM-DD) and time (HH:MM) interpreted in `tz`
// as a long human-readable string. Examples:
//   "Wednesday, 28 August 2026, 10:00"
export function formatDateTimeLong(
  date: string,
  time: string,
  tz: string,
): string {
  const dt = zonedDateTime(date, time, tz);
  return formatInstantLong(dt, tz);
}

export function formatInstantLong(dt: Date, tz: string): string {
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

// Date-only, e.g. "Wednesday, 2 September 2026". Used on the
// confirmation page where Date + Time get separate rows.
//
// mig#15: takes both `hostTz` (the zone `date`+`time` are actually
// stored in — always the host's) and `displayTz` (the zone to show
// them in). Needs `time`, not just `date`, because near a zone
// boundary the same host-local date can land on a different date in
// `displayTz` — a 09:00 Tuesday slot in Ho Chi Minh is 22:00 Monday
// in New York. Building the instant from `hostTz` first, then
// formatting it in `displayTz`, is what makes that conversion happen;
// the previous version built the instant directly in `displayTz` from
// the host-local wall clock, which is wrong whenever the two zones
// differ.
export function formatDateLong(
  date: string,
  time: string,
  hostTz: string,
  displayTz: string,
): string {
  const instant = zonedDateTime(date, time, hostTz);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: displayTz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(instant);
}

// The single "HH:MM, City, UTC±N" clock string every page, email and
// notification uses for a time shown to a person — e.g.
// "11:00, New York, UTC-4". `instant` is the UTC instant to show;
// `tz` is the zone to show it in.
//
// Zones with no city segment (a bare "UTC", no "/") render as
// "HH:MM, UTC" — appending an offset too would be redundant since the
// zone name already says "no offset". Every other zone (including
// "Europe/London" at UTC+0 in winter) always gets an offset, so
// "UTC+0" only ever shows up next to a real city name.
export function formatClockAt(instant: Date, tz: string): string {
  const hhmm = hhmmInTz(instant, tz);
  if (!tz.includes("/")) return `${hhmm}, ${zoneCity(tz)}`;
  return `${hhmm}, ${zoneCity(tz)}, ${zoneOffsetLabel(tz, instant)}`;
}

// Time-of-day + city + offset for the host-local wall-clock
// `date`+`time` (as stored on a booking, always in `hostTz`),
// displayed in `displayTz` — e.g. "11:00, New York, UTC-4". This is
// `formatClockAt` for the common case of a stored host-local booking
// time; call `formatClockAt` directly when the instant is already in
// hand (email.ts, ics.ts, notify.ts compute it once and reuse it).
//
// mig#15: this used to build the instant IN `displayTz` from the
// stored (date, time) — which are host-local, not displayTz-local —
// then format it back in `displayTz`, so it returned the unconverted
// time no matter what `displayTz` was. Building the instant from
// `hostTz` first is the fix; folding in the city+offset here is the
// feature this issue asked for.
export function formatTimeOfDay(
  date: string,
  time: string,
  hostTz: string,
  displayTz: string,
): string {
  return formatClockAt(zonedDateTime(date, time, hostTz), displayTz);
}

// Last path segment of an IANA zone name, underscores replaced by
// spaces: "America/New_York" -> "New York", "Asia/Ho_Chi_Minh" ->
// "Ho Chi Minh", "UTC" -> "UTC" (no "/", so the whole name is used).
// No lookup table — this is IANA's own naming convention, not a
// geocode, so it needs no data file and never goes stale.
export function zoneCity(tz: string): string {
  const idx = tz.lastIndexOf("/");
  const seg = idx === -1 ? tz : tz.slice(idx + 1);
  return seg.replaceAll("_", " ");
}

// "UTC+7" / "UTC-4" / "UTC+5:30" / "UTC+0". Always signed, including
// zero — "UTC+0" rather than bare "UTC" — so every offset this
// produces has the same shape and a reader never has to wonder
// whether a missing sign means "zero" or "not shown".
export function zoneOffsetLabel(tz: string, at: Date): string {
  const min = tzOffsetMinutes(at, tz);
  const sign = min < 0 ? "-" : "+";
  const abs = Math.abs(min);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return mm === 0 ? `UTC${sign}${hh}` : `UTC${sign}${hh}:${pad2(mm)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Short form used in emails subject lines + buttons. Examples:
//   "Wed 28 Aug, 10:00"
export function formatDateTimeShort(
  date: string,
  time: string,
  tz: string,
): string {
  const dt = zonedDateTime(date, time, tz);
  return formatInstantShort(dt, tz);
}

export function formatInstantShort(dt: Date, tz: string): string {
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
