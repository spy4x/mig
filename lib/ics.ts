// ICS VCALENDAR generator. Produces a single VEVENT with UTC DTSTART/DTEND
// so calendar clients display the meeting in their configured timezone.

import type { Booking, Config } from "./types.ts";
import {
  formatClockLongAt,
  formatInstantLong,
  formatOwnerClock,
  validTimeZoneOr,
  zonedDateTime,
} from "./tz.ts";

const PRODID = "-//mig//EN";
const VERSION = "2.0";

function stripUnsupportedControlCharacters(value: string): string {
  return [...value].filter((character) => {
    const code = character.codePointAt(0)!;
    return !((code <= 31 && code !== 9 && code !== 10 && code !== 13) ||
      code === 127);
  }).join("");
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

// Format a Date as YYYYMMDDTHHMMSSZ (UTC).
function icsDateUTC(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${
      pad(d.getUTCSeconds())
    }Z`
  );
}

// Escape per RFC 5545: backslash, semicolon, comma; newlines to \n.
function icsEscape(s: string): string {
  return stripUnsupportedControlCharacters(s)
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

// RFC 6868 encoding for quoted RFC 5545 parameter values.
function icsParameterEscape(s: string): string {
  return stripUnsupportedControlCharacters(s)
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("^", "^^")
    .replaceAll('"', "^'")
    .replaceAll("\n", "^n");
}

// 75-octet line folding per RFC 5545 §3.1. Continuation lines reserve
// one octet for their leading space. Iterate code points so UTF-8
// characters are never split.
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const chunks: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  let limit = 75;

  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    if (chunk && chunkBytes + characterBytes > limit) {
      chunks.push(chunk);
      chunk = "";
      chunkBytes = 0;
      limit = 74;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk) chunks.push(chunk);

  return chunks.map((value, index) => index === 0 ? value : ` ${value}`).join(
    "\r\n",
  );
}

/** Build one VCALENDAR/VEVENT invite for `booking`. DTSTART/DTEND are
 *  always UTC, computed from `booking.date`/`booking.time` interpreted
 *  in `booking.hostTz` (the real storage zone — see the `Booking`
 *  type) — neither depends on `displayTz` or `visitorTz` below, so
 *  every recipient's calendar client shows the same instant.
 *
 *  `displayTz` (default `booking.hostTz`) is the zone the
 *  DESCRIPTION's own "When:" line is rendered in when `visitorTz` is
 *  omitted — the guest's own zone for the guest's invite
 *  (`generateIcs(booking, config, cancelUrl, guestTz)`, lib/email.ts),
 *  the host's for a plain host-only invite.
 *
 *  `visitorTz`, passed only for the owner's own invite
 *  (`ownerIcs`, lib/email.ts), switches the "When:" line to the
 *  combined "host clock (visitor: visitor clock)" string
 *  `formatOwnerClock` (lib/tz.ts) already builds for the owner email
 *  body — always anchored to `booking.hostTz` for the host side (see
 *  the comment above `when` below for why `displayTz` itself must
 *  never be substituted there) and `visitorTz` for the visitor side,
 *  both for the real DTSTART instant. `displayTz` is unused in this
 *  branch. */
export function generateIcs(
  booking: Booking,
  config: Config,
  cancelUrl: string,
  displayTz = booking.hostTz,
  visitorTz?: string,
): string {
  const start = zonedDateTime(booking.date, booking.time, booking.hostTz);
  displayTz = validTimeZoneOr(displayTz, booking.hostTz);
  const end = new Date(
    start.getTime() + config.slotDurationMin * 60_000,
  );

  const summary = `Meeting with ${config.hostName}`;

  // DESCRIPTION — keep paragraphs on separate lines so most calendar
  // clients render them as actual line breaks. RFC 5545 §3.1 requires
  // us to escape `\\`, `;`, `,`, and `\n`; `icsEscape` handles that
  // before we ever set the field.
  //
  // Sections (each on its own logical line, separated by escaped
  // \n so the output reads well in clients that render it):
  //   1. When: human-readable date + time
  //   2. The meeting URL on its own line — no "Join:" label, so a
  //      fold boundary mid-line doesn't split a short word off the
  //      URL and make it ambiguous in the rendered description
  //   3. Notes: guest's notes, if any
  //   4. Cancel URL — wrapped in a single trailing line so the URL
  //      and its label travel together
  //
  // review follow-up: `visitorTz`, passed only for the owner's own
  // invite (lib/email.ts's ownerIcs), folds the visitor's clock in
  // alongside the host's own via the same formatOwnerClock the owner
  // email body already uses — so the two can't drift, and this file
  // never grows its own second "host + visitor" formatter. The
  // guest's invite never passes it, so its DESCRIPTION stays exactly
  // `formatClockLongAt(start, displayTz)`, unchanged.
  //
  // formatOwnerClock's `hostTz` parameter (lib/tz.ts) is not a
  // generic "which zone to show" — it doubles as the zone `date` and
  // `time` (host-local wall-clock values per the `Booking` type) are
  // *interpreted* in, so it must always be `booking.hostTz`, the real
  // storage zone, never `displayTz`. An earlier version of this line
  // passed `displayTz` here instead: whenever a caller's `displayTz`
  // happened to differ from `booking.hostTz`, formatOwnerClock built
  // its own instant from the wrong wall-clock interpretation entirely
  // — not just a mislabelled zone, but a different moment in time
  // than `start` (and DTSTART) below. Every real caller (lib/email.ts)
  // always passes `booking.hostTz` as `displayTz` for the owner's
  // invite, so this never showed up in practice; passing
  // `booking.hostTz` directly here instead removes the possibility.
  const when = visitorTz !== undefined
    ? formatOwnerClock(
      booking.date,
      booking.time,
      booking.hostTz,
      visitorTz,
      true,
    )
    : formatClockLongAt(start, displayTz);

  const descLines: string[] = [
    `Meeting with ${config.hostName}`,
    when,
    "",
    config.meetingUrl,
  ];
  if (booking.notes && booking.notes.trim()) {
    descLines.push("", booking.notes.trim());
  }
  descLines.push(
    "",
    "Booked via mig",
    `Cancel: ${cancelUrl}`,
  );
  const description = descLines.join("\n");

  const location = config.meetingUrl;

  const lines = [
    "BEGIN:VCALENDAR",
    `PRODID:${PRODID}`,
    `VERSION:${VERSION}`,
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${booking.id}@mig`,
    `DTSTAMP:${icsDateUTC(new Date())}`,
    `DTSTART:${icsDateUTC(start)}`,
    `DTEND:${icsDateUTC(end)}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(location)}`,
    `ORGANIZER;CN="${
      icsParameterEscape(config.hostName)
    }":mailto:${config.hostEmail}`,
    `ATTENDEE;CN="${
      icsParameterEscape(booking.guestName)
    }";RSVP=TRUE:mailto:${booking.guestEmail}`,
    `STATUS:${booking.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(fold).join("\r\n") + "\r\n";
}

// Convenience wrapper to produce a human-readable summary used in
// emails and copy-able strings. We deliberately do NOT include the
// host timezone here — that's a host detail that doesn't belong in
// visitor-facing strings.
export function meetingSummary(booking: Booking): string {
  const instant = zonedDateTime(booking.date, booking.time, booking.hostTz);
  return formatInstantLong(
    instant,
    validTimeZoneOr(booking.guestTz, booking.hostTz),
  );
}
