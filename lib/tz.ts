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

// Fixes casing and resolves slash-less legacy aliases on a
// *known-valid* zone — WITHOUT renaming a valid modern zone to a
// legacy one. "america/new_york" -> "America/New_York" (casing only),
// "Japan" -> "Asia/Tokyo", "EST5EDT" -> "America/New_York" (slash-less
// aliases, resolved the only way JS exposes: Intl's own
// resolvedOptions()), "etc/gmt+5" -> "Etc/GMT+5" (casing only, see
// below) — but "Asia/Kolkata", "Europe/Kyiv", "Asia/Ho_Chi_Minh" and
// "Asia/Kathmandu" all pass through unchanged, in whatever casing they
// arrived in.
//
// mig#15 round 2: routing every zone through resolvedOptions()
// (round-1's approach) rewrites those four modern names to their
// legacy backward-compat links under Deno's ICU (Calcutta, Kiev,
// Saigon, Katmandu) — a Ukrainian visitor saw "Kiev" everywhere, and
// worse, it made the /embed tz-redirect unstable: a browser that
// itself reports the modern name (many do) would detect
// "Asia/Kolkata", get redirected to a URL the server then rewrote to
// "Asia/Calcutta" for display, and the *next* page load would detect
// "Asia/Kolkata" again and redirect once more — two loads per click,
// forever. `Intl.supportedValuesOf("timeZone")` is a curated list that
// (for reasons out of our control) already prefers several legacy
// names over their modern replacements, so it can't be used to
// "prefer modern" either — it can only fix *casing* for whichever
// spelling it does contain.
//
// mig#18: that curated list omits some zones entirely — no casing at
// all, not even the legacy one — most `Etc/*` names (`Etc/GMT+5`) and,
// on Deno's ICU, `Asia/Ho_Chi_Minh` itself. For those, resolvedOptions()
// is the only source of a canonical spelling, but it's the same
// function that renames Kolkata to Calcutta — so it's only trusted
// here when its answer is the *same* name in different casing
// (`etc/gmt+5` -> `Etc/GMT+5`, safe: nothing changed but case). When it
// answers with a genuinely different name (`asia/ho_chi_minh` ->
// `Asia/Saigon`, a real rename), that answer is discarded and `tz` is
// returned exactly as given — uncorrected casing, but never renamed.
//
// Caller must validate first — this throws on an invalid zone, same
// as the Intl constructor it wraps. Only ever applied to zones read
// from *untrusted input* (a visitor's browser, a `tz` query param, a
// submitted `guestTz`) — never to `HOST_TZ`, which is deploy-time
// configuration the owner chose deliberately.
export function canonicalTimeZone(tz: string): string {
  const supported = Intl.supportedValuesOf("timeZone");
  if (supported.includes(tz)) return tz; // exact match — never rewritten
  if (!tz.includes("/")) {
    // Slash-less alias ("Japan", "EST5EDT", "GMT") — there's no
    // "modern name" to preserve for these; resolvedOptions() is the
    // only way to resolve one at all.
    return new Intl.DateTimeFormat("en", { timeZone: tz }).resolvedOptions()
      .timeZone;
  }
  // Wrong casing of a name the curated list does contain (e.g.
  // "america/new_york") — fix the casing, nothing else.
  const lower = tz.toLowerCase();
  const curated = supported.find((s) => s.toLowerCase() === lower);
  if (curated) return curated;
  // Not in the curated list under any casing at all (e.g.
  // "Etc/GMT+5", "Asia/Ho_Chi_Minh"). resolvedOptions() is trusted
  // only when it resolves to the very same name, just differently
  // cased — never when it resolves to a different name (a legacy
  // rename, the round-2 bug).
  const resolved = new Intl.DateTimeFormat("en", { timeZone: tz })
    .resolvedOptions().timeZone;
  return resolved.toLowerCase() === lower ? resolved : tz;
}

// Validates + canonicalizes an untrusted zone string in one step.
// Returns the canonical IANA name, or `null` if `value` is missing or
// invalid — never throws.
export function canonicalValidTimeZoneOrNull(
  value: string | undefined | null,
): string | null {
  if (!value || !isValidTimeZone(value)) return null;
  return canonicalTimeZone(value);
}

export function validTimeZoneOr(
  value: string | undefined,
  fallback: string,
): string {
  return canonicalValidTimeZoneOrNull(value) ?? fallback;
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
// `tz` should already be canonical (see canonicalTimeZone) — this
// does no validation of its own.
//
// Zones with no city segment (a bare "UTC", no "/") render as
// "HH:MM, UTC" — appending an offset too would be redundant since the
// zone name already says "no offset". `Etc/*` zones (e.g. "Etc/GMT+5",
// which — confusingly, per POSIX — means UTC-5) render offset-only,
// "HH:MM, UTC-5": "GMT+5" isn't a place, and showing it next to its
// own sign-inverted offset would just look wrong. Every other zone
// (including "Europe/London" at UTC+0 in winter) always gets an
// offset, so "UTC+0" only ever shows up next to a real city name.
//
// mig#18: the "Etc/" check is case-insensitive. `canonicalTimeZone`
// fixes "etc/gmt+5"'s casing before it gets here in the normal flow,
// but this is the one place a wrongly-cased Etc zone would otherwise
// show its raw segment ("gmt+5") as if it were a city — a
// case-sensitive check here would depend on every caller having
// canonicalized first, which the doc comment above doesn't actually
// promise.
export function formatClockAt(instant: Date, tz: string): string {
  const hhmm = hhmmInTz(instant, tz);
  if (!tz.includes("/")) return `${hhmm}, ${zoneCity(tz)}`;
  if (isEtcZone(tz)) return `${hhmm}, ${zoneOffsetLabel(tz, instant)}`;
  return `${hhmm}, ${zoneCity(tz)}, ${zoneOffsetLabel(tz, instant)}`;
}

// Case-insensitive "Etc/" prefix check — see formatClockAt's doc
// comment for why this can't assume its input is already canonical.
function isEtcZone(tz: string): boolean {
  return tz.slice(0, 4).toLowerCase() === "etc/";
}

// "Wed 23 Sep" — short weekday + day + month, no year. Used to label
// an individual slot whose visitor-local date differs from the picked
// host day (mig#15 review), and as the date part of formatClockShortAt.
export function formatShortDateAt(instant: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  // "Wed, 23 Sep" -> "Wed 23 Sep" — strip the comma after the weekday,
  // same trick as formatInstantShort.
  return fmt.format(instant).replace(/^([^,]+),/, "$1");
}

// "Thu 24 Sep 09:00, Ho Chi Minh, UTC+7" — short dated clock, used in
// subject lines and NTFY pushes where the long form (formatInstantLong
// + city/offset) would be too long.
export function formatClockShortAt(instant: Date, tz: string): string {
  return `${formatShortDateAt(instant, tz)} ${formatClockAt(instant, tz)}`;
}

// "Friday, 28 August 2026 at 04:00, New York, UTC-4" — long dated
// clock, used in email bodies.
export function formatClockLongAt(instant: Date, tz: string): string {
  return `${formatInstantLong(instant, tz)}, ${
    isEtcZone(tz) ? zoneOffsetLabel(tz, instant) : (
      tz.includes("/")
        ? `${zoneCity(tz)}, ${zoneOffsetLabel(tz, instant)}`
        : zoneCity(tz)
    )
  }`;
}

// Owner-facing combined clock (mig#15 review): the host's own dated
// clock, plus the visitor's clock alongside it whenever a valid
// visitor zone is known — with the visitor's own date too, but only
// when it differs from the host's (same day is implied otherwise, so
// "22:00, New York, UTC-4" reads as "still today" while "Wed 23 Sep
// 22:00, New York, UTC-4" reads as "the day before"). Falls back to
// the host clock alone when no visitor zone was captured — never a
// guessed one. `long` picks formatClockLongAt (email bodies) over
// formatClockShortAt (subjects, NTFY).
export function formatOwnerClock(
  date: string,
  time: string,
  hostTz: string,
  guestTz: string | undefined,
  long = false,
): string {
  const instant = zonedDateTime(date, time, hostTz);
  const host = long
    ? formatClockLongAt(instant, hostTz)
    : formatClockShortAt(instant, hostTz);
  const guestTzCanonical = canonicalValidTimeZoneOrNull(guestTz);
  if (!guestTzCanonical) return host;
  const sameDay = isoDateInTz(instant, hostTz) ===
    isoDateInTz(instant, guestTzCanonical);
  const guest = sameDay
    ? formatClockAt(instant, guestTzCanonical)
    : long
    ? formatClockLongAt(instant, guestTzCanonical)
    : formatClockShortAt(instant, guestTzCanonical);
  return `${host} (visitor: ${guest})`;
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
