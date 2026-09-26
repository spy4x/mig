// The booking's calendar invite: maps a Booking onto
// `@spy4x/time/ics`'s one-event writer, which owns the RFC 5545 wire
// format (escaping, 75-octet folding, UTC DATE-TIME). Only the
// mig-specific parts live here — which zone the DESCRIPTION's "When:"
// line reads in, and what the event carries (mig#57).

import {
  generateIcs,
  type IcsEvent,
  IcsEventStatus,
  type IcsOptions,
} from "@spy4x/time/ics";
import { zonedDateTime } from "@spy4x/time/tz";
import type { Booking, Config } from "./types.ts";
import {
  canonicalTimeZoneOr,
  formatClockLongAt,
  formatOwnerClock,
} from "./clock.ts";

const PRODID = "-//mig//EN";

/** Build one VCALENDAR/VEVENT invite for `booking`. DTSTART/DTEND are
 *  always UTC, computed from `booking.date`/`booking.time` interpreted
 *  in `booking.hostTz` (the real storage zone — see the `Booking`
 *  type) — neither depends on `displayTz` or `visitorTz` below, so
 *  every recipient's calendar client shows the same instant.
 *
 *  `displayTz` (default `booking.hostTz`) is the zone the
 *  DESCRIPTION's own "When:" line is rendered in when `visitorTz` is
 *  omitted — the guest's own zone for the guest's invite
 *  (`bookingIcs(booking, config, cancelUrl, guestTz)`, lib/email.ts),
 *  the host's for a plain host-only invite.
 *
 *  `visitorTz`, passed only for the owner's own invite
 *  (`ownerIcs`, lib/email.ts), switches the "When:" line to the
 *  combined "host clock (visitor: visitor clock)" string
 *  `formatOwnerClock` (lib/clock.ts) already builds for the owner email
 *  body — always anchored to `booking.hostTz` for the host side (see
 *  the comment above `when` below for why `displayTz` itself must
 *  never be substituted there) and `visitorTz` for the visitor side,
 *  both for the real DTSTART instant. `displayTz` is unused in this
 *  branch. */
export function bookingIcs(
  booking: Booking,
  config: Config,
  cancelUrl: string,
  displayTz = booking.hostTz,
  visitorTz?: string,
  now = new Date(),
): string {
  const { event, options } = bookingInvite(
    booking,
    config,
    cancelUrl,
    displayTz,
    visitorTz,
    now,
  );
  return generateIcs(event, options);
}

/** The event and calendar options `bookingIcs` writes, for a caller
 *  that hands them to another writer (lib/email.ts's `icalAttachment`).
 *  Same parameters as `bookingIcs`. */
export function bookingInvite(
  booking: Booking,
  config: Config,
  cancelUrl: string,
  displayTz = booking.hostTz,
  visitorTz?: string,
  now = new Date(),
): { event: IcsEvent; options: IcsOptions } {
  const start = zonedDateTime(booking.date, booking.time, booking.hostTz);
  displayTz = canonicalTimeZoneOr(displayTz, booking.hostTz);
  const end = new Date(
    start.getTime() + config.slotDurationMin * 60_000,
  );

  const summary = `Meeting with ${config.hostName}`;

  // DESCRIPTION — keep paragraphs on separate lines so most calendar
  // clients render them as actual line breaks. RFC 5545 §3.1 requires
  // us to escape `\\`, `;`, `,`, and `\n`; `@spy4x/time/ics` does
  // that for every TEXT value it writes.
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
  // formatOwnerClock's `hostTz` parameter (lib/clock.ts) is not a
  // generic "which zone to show" — it doubles as the zone `date` and
  // `time` (host-local wall-clock values per the `Booking` type) are
  // *interpreted* in. It must always be `booking.hostTz`, the real
  // storage zone, never `displayTz`: passing anything else would have
  // formatOwnerClock build its own instant from the wrong wall-clock
  // interpretation entirely — not just a mislabelled zone, but a
  // different moment in time than `start` (and DTSTART) below.
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

  // `now` is DTSTAMP: the moment this invite was written. A parameter
  // so a test can pin it; `@spy4x/time/ics` never reads the clock itself.
  return {
    event: {
      uid: `${booking.id}@mig`,
      start,
      end,
      summary,
      description,
      location: config.meetingUrl,
      status: booking.status === "cancelled"
        ? IcsEventStatus.CANCELLED
        : IcsEventStatus.CONFIRMED,
      organizer: { email: config.hostEmail, name: config.hostName },
      attendees: [{
        email: booking.guestEmail,
        name: booking.guestName,
        rsvp: true,
      }],
    },
    options: { prodid: PRODID, dtstamp: now },
  };
}
