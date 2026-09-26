// Email: SMTP through @spy4x/email's sender (nodemailer underneath).
// Sends multipart/alternative (text + HTML) emails, optionally with an
// ICS attachment. Every send returns a Result instead of throwing.

import { createSmtpSender, type SmtpTransport } from "@spy4x/email/smtp";
import {
  DARK_HTML_SHELL_THEME,
  escapeHtml as esc,
  htmlWrap as shellWrap,
} from "@spy4x/email/html";
import { type EmailAttachment, icalAttachment } from "@spy4x/email/message";
import type { Config } from "./types.ts";
import type { Booking } from "./types.ts";
import { err, ok, type Result } from "./types.ts";
import { bookingInvite } from "./invite.ts";
import { isValidTimeZone, zonedDateTime } from "@spy4x/time/tz";
import {
  canonicalTimeZoneOr,
  formatClockLongAt,
  formatClockShortAt,
  formatOwnerClock,
} from "./clock.ts";

// The one line shown instead of an unlabelled host time whenever a
// recipient's own zone isn't known (mig#15 review) — no other new
// copy anywhere, per the spec.
const HOST_TZ_NOTE = "Times are shown in the host's timezone.";

export interface SendEmailOpts {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface RecipientEmails {
  guest: SendEmailOpts;
  owner: SendEmailOpts;
}

/** What a send reports: nothing on success, the (password-free)
 *  reason on failure. */
export type SendOutcome = Result<void, string>;

let transportForTesting: SmtpTransport | null = null;

/** Test-only seam: replace the transport `sendEmail` uses instead of
 *  building one from `config.smtp` (which would otherwise open a real
 *  socket to `config.smtp.host`). Pass an object whose `sendMail`
 *  resolves or rejects, or `null` to go back to the real transport on
 *  the next send. Never call this outside a test. */
export function setTransportForTesting(t: SmtpTransport | null): void {
  transportForTesting = t;
}

export async function sendEmail(
  config: Config,
  opts: SendEmailOpts,
): Promise<SendOutcome> {
  const testTransport = transportForTesting;
  try {
    const sender = createSmtpSender(
      {
        host: config.smtp.host,
        port: config.smtp.port,
        user: config.smtp.user,
        pass: config.smtp.pass,
        from: config.smtp.from,
        // mig has always upgraded to TLS only when the relay offers
        // STARTTLS. Requiring it would stop every booking on a relay
        // without it (a local postfix, the screenshot script's sink).
        requireTls: false,
      },
      testTransport === null ? undefined : () => testTransport,
    );
    const sent = await sender.send({
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments,
    });
    return sent.ok ? ok(undefined) : err(sent.error);
  } catch (e) {
    // createSmtpSender throws only on a malformed SMTP_* setting, which
    // lib/config.ts already rejects at startup; the message names the
    // setting, never the password.
    return err(
      `SMTP send failed (${config.smtp.host}): ${(e as Error).message}`,
    );
  }
}

/** Builds one email and sends it; a throw while building is reported
 *  as a failed send, since nothing went out either way. */
async function buildAndSend(
  config: Config,
  build: () => SendEmailOpts,
): Promise<SendOutcome> {
  let opts: SendEmailOpts;
  try {
    opts = build();
  } catch (e) {
    return err(`email could not be built: ${(e as Error).message}`);
  }
  return await sendEmail(config, opts);
}

// mig#19: split into two functions, owner then guest, rather than one
// sendBookingEmails — lib/book.ts needs to know whether the owner's
// send went out before the guest's one failed, so it can correct the
// owner (sendBookingCorrectionEmail, below) instead of leaving them
// with a stale "New booking" email and invite for a booking the
// failure just rolled back. Reporting that from a single combined
// function would need a result type; two calls that lib/book.ts can
// wrap its own try/catch around is the smaller change. The one cost
// is buildBookingEmails() running twice on the common (both sends
// succeed) path instead of once — cheap, since it's pure string
// building with no I/O.
//
// Owner first: a booking that ends up rolled back must never have
// reached the guest with a "Booking confirmed" message and a
// calendar invite for a meeting that no longer exists — that
// phantom-meeting scenario is the bug #19 was filed for. Owner first
// means an owner-side failure (e.g. a bad HOST_EMAIL) reaches nobody;
// a guest-side failure after a successful owner send is handled by
// lib/book.ts's correction email and, best-effort, by the NTFY push
// in lib/notify.ts.
export function sendOwnerBookingEmail(
  config: Config,
  booking: Booking,
  cancelUrl: string,
): Promise<SendOutcome> {
  return buildAndSend(
    config,
    () => buildBookingEmails(config, booking, cancelUrl).owner,
  );
}

export function sendGuestBookingEmail(
  config: Config,
  booking: Booking,
  cancelUrl: string,
): Promise<SendOutcome> {
  return buildAndSend(
    config,
    () => buildBookingEmails(config, booking, cancelUrl).guest,
  );
}

export interface CorrectionEmailOpts {
  /** Whether the post-send-failure rollback actually removed the
   *  booking, mirroring EmailFailedOpts.rolledBack in lib/notify.ts.
   *  Required — no default, so a caller can't forget to check the
   *  rollback's own outcome and repeat the bug this option exists to
   *  fix: claiming the booking "was removed and the slot is free
   *  again" when the rollback's own disk write also failed and the
   *  booking may still be on disk. */
  rolledBack: boolean;
}

// mig#19 review round 3: sent by lib/book.ts only when the owner's
// "New booking" email went out and the guest's one then failed — by
// the time this runs, the booking has already been rolled back, so
// without this the host is left with an email and a calendar invite
// for a meeting that no longer exists, and the only other signal (the
// NTFY push in lib/notify.ts) is optional and off unless NTFY_* is
// configured.
//
// mig#27: the text above assumed the rollback always succeeded. When
// the rollback's own disk write fails too (lib/book.ts's `rolledBack`
// goes false), the booking may still be on disk and come back after a
// restart — `opts.rolledBack` picks the matching wording instead.
export function sendBookingCorrectionEmail(
  config: Config,
  booking: Booking,
  opts: CorrectionEmailOpts,
): Promise<SendOutcome> {
  return buildAndSend(config, () => correctionEmail(config, booking, opts));
}

function correctionEmail(
  config: Config,
  booking: Booking,
  opts: CorrectionEmailOpts,
): SendEmailOpts {
  const { rolledBack } = opts;
  const ownerWhenShort = formatOwnerClock(
    booking.date,
    booking.time,
    booking.hostTz,
    booking.guestTz,
  );
  const ownerWhenLong = formatOwnerClock(
    booking.date,
    booking.time,
    booking.hostTz,
    booking.guestTz,
    true,
  );
  return {
    to: config.hostEmail,
    subject: rolledBack
      ? `Not booked: ${booking.guestName}, ${ownerWhenShort}`
      : `Not booked, remove by hand: ${booking.guestName}, ${ownerWhenShort}`,
    text: correctionText(config, booking, ownerWhenLong, rolledBack),
    html: correctionHtml(config, booking, ownerWhenLong, rolledBack),
    // No .ics attachment: properly retracting the invite already sent
    // needs a METHOD:CANCEL companion with the same UID and a higher
    // SEQUENCE. bookingIcs in lib/invite.ts writes METHOD:CANCEL for a
    // cancelled booking, but sets no SEQUENCE, so a client may not treat
    // it as replacing the REQUEST. The email body below tells the host to
    // ignore the earlier invite instead.
  };
}

function correctionText(
  config: Config,
  booking: Booking,
  ownerWhen: string,
  rolledBack: boolean,
): string {
  return [
    `Hi ${config.hostName},`,
    "",
    rolledBack
      ? "The booking below was NOT created after all."
      : "The booking below was NOT confirmed.",
    "",
    `Guest: ${booking.guestName} <${booking.guestEmail}>`,
    `When:  ${ownerWhen}`,
    "",
    rolledBack
      ? "The guest's confirmation email failed to send, so the booking " +
        "was removed and the slot is free again. Please disregard the " +
        '"New booking" email and calendar invite you received a moment ' +
        "ago."
      : "The guest's confirmation email failed to send, and removing " +
        "the booking failed too. It may still be on disk and come " +
        `back after a restart. Remove it by hand: booking id ${booking.id} ` +
        'in the data file. Please disregard the "New booking" email ' +
        "and calendar invite you received a moment ago.",
    "",
    "— Sent by mig",
  ].join("\n");
}

function correctionHtml(
  config: Config,
  booking: Booking,
  ownerWhen: string,
  rolledBack: boolean,
): string {
  return htmlWrap(
    config,
    `
    <p>Hi ${esc(config.hostName)},</p>
    ${
      rolledBack
        ? "<p>The booking below was <strong>NOT</strong> created after all.</p>"
        : "<p>The booking below was <strong>NOT</strong> confirmed.</p>"
    }
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Guest</td>
          <td style="padding:4px 0">${esc(booking.guestName)} &lt;${
      esc(booking.guestEmail)
    }&gt;</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">When</td>
          <td style="padding:4px 0">${esc(ownerWhen)}</td></tr>
    </table>
    ${
      rolledBack
        ? `<p>The guest's confirmation email failed to send, so the booking
    was removed and the slot is free again. Please disregard the
    &ldquo;New booking&rdquo; email and calendar invite you received a
    moment ago.</p>`
        : `<p>The guest's confirmation email failed to send, and removing
    the booking failed too. It may still be on disk and come back
    after a restart. Remove it by hand: booking id ${
          esc(booking.id)
        } in the data file. Please disregard the &ldquo;New
    booking&rdquo; email and calendar invite you received a moment
    ago.</p>`
    }
  `,
  );
}

export function buildBookingEmails(
  config: Config,
  booking: Booking,
  cancelUrl: string,
): RecipientEmails {
  const guestTz = guestTimeZone(booking);
  const guestIcs = inviteAttachment(
    bookingInvite(booking, config, cancelUrl, guestTz),
  );
  // review follow-up: the owner's invite now carries the visitor's
  // clock too, the same way the owner email body already does — see
  // bookingIcs's doc comment. The guest's own ics above passes no
  // `visitorTz`, so its DESCRIPTION is unaffected.
  const ownerIcs = inviteAttachment(
    bookingInvite(booking, config, cancelUrl, booking.hostTz, booking.guestTz),
  );
  const instant = bookingInstant(booking);
  const guestWhen = formatClockShortAt(instant, guestTz);
  const ownerWhen = formatOwnerClock(
    booking.date,
    booking.time,
    booking.hostTz,
    booking.guestTz,
  );

  return {
    guest: {
      to: booking.guestEmail,
      subject: `Booking confirmed: ${guestWhen}`,
      text: guestText(config, booking, cancelUrl),
      html: guestHtml(config, booking, cancelUrl),
      attachments: [guestIcs],
    },
    owner: {
      to: config.hostEmail,
      subject: `New booking: ${booking.guestName} on ${ownerWhen}`,
      text: ownerText(config, booking, cancelUrl),
      html: ownerHtml(config, booking, cancelUrl),
      attachments: [ownerIcs],
    },
  };
}

// Guest first, then owner; stops at the first failure, as it did when
// a failed send threw.
export async function sendCancellationEmails(
  config: Config,
  booking: Booking,
  cancelledBy: "owner" | "guest",
  reason: string | undefined,
): Promise<SendOutcome> {
  let emails: RecipientEmails;
  try {
    emails = buildCancellationEmails(config, booking, cancelledBy, reason);
  } catch (e) {
    return err(`email could not be built: ${(e as Error).message}`);
  }
  const guest = await sendEmail(config, emails.guest);
  if (!guest.ok) return guest;
  return await sendEmail(config, emails.owner);
}

export function buildCancellationEmails(
  config: Config,
  booking: Booking,
  cancelledBy: "owner" | "guest",
  reason: string | undefined,
): RecipientEmails {
  const guestTz = guestTimeZone(booking);
  const knownGuestTz = isKnownTimeZone(booking.guestTz);
  const instant = bookingInstant(booking);
  const cancelledAt = new Date();
  const guestWhen = formatClockShortAt(instant, guestTz);
  const ownerWhen = formatOwnerClock(
    booking.date,
    booking.time,
    booking.hostTz,
    booking.guestTz,
  );
  const reasonText = reason?.trim() || "(no reason given)";

  // Each recipient gets a "Cancelled by:" line in their own frame of
  // reference: "you" when they themselves cancelled, or the
  // canceller's name (+ email) when the other party did. This avoids
  // the old "Cancelled by: the guest" line that left the host
  // wondering which guest it was.
  const guestBody =
    `The meeting scheduled for ${guestWhen} with ${config.hostName} ` +
    `has been cancelled.`;
  const hostBody =
    `The meeting scheduled for ${ownerWhen} with ${booking.guestName} ` +
    `has been cancelled.`;
  const guestCancellerLabel = cancelledBy === "guest"
    ? "you"
    : `${config.hostName}`;
  const hostCancellerLabel = cancelledBy === "guest"
    ? `${booking.guestName} <${booking.guestEmail}>`
    : "you";

  return {
    guest: {
      to: booking.guestEmail,
      subject: `Your booking on ${guestWhen} was cancelled`,
      text: cancellationText({
        greeting: `Hi ${booking.guestName},`,
        body: guestBody,
        cancellerLabel: guestCancellerLabel,
        reason: reasonText,
        cancelledAtLabel: formatClockShortAt(cancelledAt, guestTz),
        tzNote: knownGuestTz ? undefined : HOST_TZ_NOTE,
      }),
      html: cancellationHtml(config, {
        greeting: `Hi ${booking.guestName},`,
        body: guestBody,
        cancellerLabel: guestCancellerLabel,
        reason: reasonText,
        cancelledAtLabel: formatClockShortAt(cancelledAt, guestTz),
        tzNote: knownGuestTz ? undefined : HOST_TZ_NOTE,
      }),
    },
    owner: {
      to: config.hostEmail,
      subject: `Booking cancelled: ${booking.guestName}, ${ownerWhen}`,
      text: cancellationText({
        greeting: `Hi ${config.hostName},`,
        body: hostBody,
        cancellerLabel: hostCancellerLabel,
        reason: reasonText,
        cancelledAtLabel: formatClockShortAt(cancelledAt, booking.hostTz),
      }),
      html: cancellationHtml(config, {
        greeting: `Hi ${config.hostName},`,
        body: hostBody,
        cancellerLabel: hostCancellerLabel,
        reason: reasonText,
        cancelledAtLabel: formatClockShortAt(cancelledAt, booking.hostTz),
      }),
    },
  };
}

// ---------- Plain-text + HTML templates ----------

function guestText(
  config: Config,
  booking: Booking,
  cancelUrl: string,
): string {
  const lines = [
    `Hi ${booking.guestName},`,
    "",
    `Your meeting with ${config.hostName} is booked.`,
    "",
    `When:  ${
      formatClockLongAt(bookingInstant(booking), guestTimeZone(booking))
    }`,
  ];
  if (!isKnownTimeZone(booking.guestTz)) lines.push(HOST_TZ_NOTE);
  lines.push(
    `Where: ${config.meetingUrl}`,
    "",
    "Add to calendar: open the attached .ics file.",
    "",
    `Need to cancel?`,
    cancelUrl,
    "",
    "— Sent by mig",
  );
  return lines.join("\n");
}

function guestHtml(
  config: Config,
  booking: Booking,
  cancelUrl: string,
): string {
  const tzNoteHtml = isKnownTimeZone(booking.guestTz)
    ? ""
    : `<p style="color:#94a3b8;font-size:13px;margin-top:-8px">${
      esc(HOST_TZ_NOTE)
    }</p>`;
  return htmlWrap(
    config,
    `
    <p>Hi ${esc(booking.guestName)},</p>
    <p>Your meeting with <strong>${esc(config.hostName)}</strong> is booked.</p>
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">When</td>
          <td style="padding:4px 0">${
      esc(formatClockLongAt(bookingInstant(booking), guestTimeZone(booking)))
    }</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Where</td>
          <td style="padding:4px 0"><a href="${
      esc(config.meetingUrl)
    }" style="color:#f97316">${esc(config.meetingUrl)}</a></td></tr>
    </table>
    ${tzNoteHtml}
    <p>Add to calendar: open the attached <code>.ics</code> file.</p>
    <p>Need to cancel? <a href="${
      esc(cancelUrl)
    }" style="color:#f97316">Click here</a></p>
  `,
  );
}

function ownerText(
  _config: Config,
  booking: Booking,
  cancelUrl: string,
): string {
  const lines = [
    `New booking received.`,
    "",
    `Guest:    ${booking.guestName} <${booking.guestEmail}>`,
    `When:     ${
      formatOwnerClock(
        booking.date,
        booking.time,
        booking.hostTz,
        booking.guestTz,
        true,
      )
    }`,
  ];
  if (booking.notes?.trim()) {
    lines.push(`Notes:    ${booking.notes.trim()}`);
  }
  lines.push(
    `Booked at: ${
      formatClockShortAt(new Date(booking.createdAt), booking.hostTz)
    }`,
    "",
    `Cancel: ${cancelUrl}`,
    "",
    "— Sent by mig",
  );
  return lines.join("\n");
}

function ownerHtml(
  config: Config,
  booking: Booking,
  cancelUrl: string,
): string {
  const notesHtml = booking.notes?.trim()
    ? `<tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Notes</td>
          <td style="padding:4px 0;white-space:pre-wrap">${
      esc(booking.notes.trim())
    }</td></tr>`
    : "";
  return htmlWrap(
    config,
    `
    <p>New booking received.</p>
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Guest</td>
          <td style="padding:4px 0">${esc(booking.guestName)} &lt;${
      esc(booking.guestEmail)
    }&gt;</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">When</td>
          <td style="padding:4px 0">${
      esc(
        formatOwnerClock(
          booking.date,
          booking.time,
          booking.hostTz,
          booking.guestTz,
          true,
        ),
      )
    }</td></tr>
      ${notesHtml}
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Booked at</td>
          <td style="padding:4px 0">${
      esc(formatClockShortAt(new Date(booking.createdAt), booking.hostTz))
    }</td></tr>
    </table>
    <p><a href="${
      esc(cancelUrl)
    }" style="color:#f97316">Cancel this booking</a></p>
  `,
  );
}

function cancellationText(opts: {
  greeting: string;
  body: string;
  cancellerLabel: string;
  reason: string;
  cancelledAtLabel: string;
  tzNote?: string;
}): string {
  const lines = [
    opts.greeting,
    "",
    opts.body,
  ];
  if (opts.tzNote) lines.push(opts.tzNote);
  lines.push(
    "",
    `Cancelled by: ${opts.cancellerLabel}`,
    `Reason: ${opts.reason}`,
    `Cancelled at: ${opts.cancelledAtLabel}`,
    "",
    "— Sent by mig",
  );
  return lines.join("\n");
}

function cancellationHtml(
  config: Config,
  opts: {
    greeting: string;
    body: string;
    cancellerLabel: string;
    reason: string;
    cancelledAtLabel: string;
    tzNote?: string;
  },
): string {
  const tzNoteHtml = opts.tzNote
    ? `<p style="color:#94a3b8;font-size:13px">${esc(opts.tzNote)}</p>`
    : "";
  return htmlWrap(
    config,
    `
    <p>${esc(opts.greeting.replace(/,$/, ""))},</p>
    <p>${esc(opts.body)}</p>
    ${tzNoteHtml}
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Cancelled by</td>
          <td style="padding:4px 0">${esc(opts.cancellerLabel)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Reason</td>
          <td style="padding:4px 0">${esc(opts.reason)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Cancelled at</td>
          <td style="padding:4px 0">${esc(opts.cancelledAtLabel)}</td></tr>
    </table>
  `,
  );
}

function bookingInstant(booking: Booking): Date {
  return zonedDateTime(booking.date, booking.time, booking.hostTz);
}

function isKnownTimeZone(tz: string | undefined): boolean {
  return !!tz && isValidTimeZone(tz);
}

function guestTimeZone(booking: Booking): string {
  return canonicalTimeZoneOr(booking.guestTz, booking.hostTz);
}

/** An invite as a `meeting.ics` attachment; its Content-Type carries
 *  the METHOD the calendar body itself declares. */
function inviteAttachment(
  invite: ReturnType<typeof bookingInvite>,
): EmailAttachment {
  return icalAttachment(invite.event, {
    ics: invite.options,
    filename: "meeting.ics",
  });
}

// Constrained to 480px so the email reads as a letter, not a full
// desktop pane, on the dark shell mig's emails have always used.
function htmlWrap(config: Config, body: string): string {
  // The signature is mig's own muted, underlined link, not the
  // shell's orange one, so it stays quieter than the header.
  return shellWrap({
    body,
    brand: "mig",
    brandUrl: config.githubUrl,
    theme: DARK_HTML_SHELL_THEME,
    maxWidth: 480,
    signaturePrefix: null,
    footer:
      `<p style="color:#64748b;font-size:14px;margin-top:24px">— Sent by <a href="${
        esc(config.githubUrl)
      }" style="color:#64748b;text-decoration:underline">mig</a></p>`,
  });
}
