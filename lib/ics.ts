// ICS VCALENDAR generator. Produces a single VEVENT with timezone-aware
// DTSTART/DTEND so calendar clients display the meeting in host TZ.

import type { Booking, Config } from "./types.ts";
import { formatDateTimeLong, zonedDateTime } from "./tz.ts";

const PRODID = "-//mig//EN";
const VERSION = "2.0";

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
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

// 75-octet line folding per RFC 5545 §3.1. We prefer to break at a
// space when one exists within the last ~20 chars of the chunk,
// rather than splitting mid-word. The space is included in the
// current chunk (so the next chunk's leading whitespace — which
// the client strips on unfold — doesn't eat the original space
// and collapse words together).
function fold(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let remaining = line;
  const firstMax = 75; // first chunk has no leading space
  const contMax = 74; // continuation chunks have a leading space (1 octet)
  while (remaining.length > firstMax) {
    const limit = chunks.length === 0 ? firstMax : contMax;
    let breakAt = -1;
    // Search backwards for a space inside the chunk window. The
    // floor (limit - 20) avoids breaking in the middle of a
    // long URL just because it has no spaces anywhere.
    for (let i = Math.min(limit, remaining.length) - 1; i > limit - 20; i--) {
      if (remaining[i] === " ") {
        breakAt = i;
        break;
      }
    }
    if (breakAt === -1) {
      chunks.push(remaining.slice(0, limit));
      remaining = (chunks.length === 0 ? "" : " ") + remaining.slice(limit);
    } else {
      // Include the space at breakAt in the current chunk. The
      // continuation line's leading whitespace (the 1-octet
      // continuation indicator) is what gets stripped on unfold,
      // not this space.
      chunks.push(remaining.slice(0, breakAt + 1));
      remaining = " " + remaining.slice(breakAt + 1);
    }
  }
  chunks.push(remaining);
  return chunks.join("\r\n");
}

export function generateIcs(
  booking: Booking,
  config: Config,
  cancelUrl: string,
): string {
  const start = zonedDateTime(booking.date, booking.time, booking.hostTz);
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
  const when = formatDateTimeLong(booking.date, booking.time, booking.hostTz);

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
    `ORGANIZER;CN=${icsEscape(config.hostName)}:mailto:${config.hostEmail}`,
    `ATTENDEE;CN=${
      icsEscape(booking.guestName)
    };RSVP=TRUE:mailto:${booking.guestEmail}`,
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
  return formatDateTimeLong(booking.date, booking.time, booking.hostTz);
}
