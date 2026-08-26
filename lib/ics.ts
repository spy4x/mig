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

// 75-octet line folding per RFC 5545 §3.1.
function fold(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  while (i < line.length) {
    chunks.push((i === 0 ? "" : " ") + line.slice(i, i + 73));
    i += 73;
  }
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
  const description = `Booked via mig (${config.publicUrl})\n` +
    `Meeting link: ${config.meetingUrl}\n` +
    `Cancel: ${cancelUrl}`;
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

// Convenience wrapper to produce a human-readable summary in the email.
export function meetingSummary(booking: Booking): string {
  return `${
    formatDateTimeLong(booking.date, booking.time, booking.hostTz)
  } (${booking.hostTz})`;
}
