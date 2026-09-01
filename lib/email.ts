// SMTP via nodemailer. Sends multipart/alternative (text + HTML) emails,
// optionally with an ICS attachment.

import nodemailer from "nodemailer";
import type { Config } from "./types.ts";
import type { Booking } from "./types.ts";
import { generateIcs } from "./ics.ts";
import {
  formatInstantLong,
  formatInstantShort,
  validTimeZoneOr,
  zonedDateTime,
} from "./tz.ts";

export interface SendEmailOpts {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: string;
    contentType: string;
  }>;
}

export interface RecipientEmails {
  guest: SendEmailOpts;
  owner: SendEmailOpts;
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransport(config: Config) {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465, // implicit TLS for 465, STARTTLS otherwise
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });
  return transporter;
}

function parseAddress(from: string): { name: string; addr: string } {
  const m = from.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), addr: m[2].trim() };
  return { name: "", addr: from.trim() };
}

export async function sendEmail(
  config: Config,
  opts: SendEmailOpts,
): Promise<void> {
  const t = getTransport(config);
  const sender = parseAddress(config.smtp.from);
  try {
    await t.sendMail({
      from: sender.name ? `${sender.name} <${sender.addr}>` : sender.addr,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html ?? opts.text,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
        encoding: "utf8",
      })),
    });
  } catch (e) {
    throw new Error(
      `SMTP send failed (${config.smtp.host}:${config.smtp.port}, to=${opts.to}): ${
        (e as Error).message
      }`,
    );
  }
}

export async function sendBookingEmails(
  config: Config,
  booking: Booking,
  cancelUrl: string,
): Promise<void> {
  const emails = buildBookingEmails(config, booking, cancelUrl);
  await sendEmail(config, emails.guest);
  await sendEmail(config, emails.owner);
}

export function buildBookingEmails(
  config: Config,
  booking: Booking,
  cancelUrl: string,
): RecipientEmails {
  const guestTz = guestTimeZone(booking);
  const guestIcs = generateIcs(booking, config, cancelUrl, guestTz);
  const ownerIcs = generateIcs(booking, config, cancelUrl, booking.hostTz);
  const guestWhen = whenShort(booking, guestTz);
  const ownerWhen = whenShort(booking, booking.hostTz);

  return {
    guest: {
      to: booking.guestEmail,
      subject: `Booking confirmed: ${guestWhen}`,
      text: guestText(config, booking, cancelUrl),
      html: guestHtml(config, booking, cancelUrl),
      attachments: [
        {
          filename: "meeting.ics",
          content: guestIcs,
          contentType: "text/calendar; method=REQUEST",
        },
      ],
    },
    owner: {
      to: config.hostEmail,
      subject: `New booking: ${booking.guestName} on ${ownerWhen}`,
      text: ownerText(config, booking, cancelUrl),
      html: ownerHtml(config, booking, cancelUrl),
      attachments: [
        {
          filename: "meeting.ics",
          content: ownerIcs,
          contentType: "text/calendar; method=REQUEST",
        },
      ],
    },
  };
}

export async function sendCancellationEmails(
  config: Config,
  booking: Booking,
  cancelledBy: "owner" | "guest",
  reason: string | undefined,
): Promise<void> {
  const emails = buildCancellationEmails(config, booking, cancelledBy, reason);
  await sendEmail(config, emails.guest);
  await sendEmail(config, emails.owner);
}

export function buildCancellationEmails(
  config: Config,
  booking: Booking,
  cancelledBy: "owner" | "guest",
  reason: string | undefined,
): RecipientEmails {
  const guestTz = guestTimeZone(booking);
  const guestWhen = whenShort(booking, guestTz);
  const ownerWhen = whenShort(booking, booking.hostTz);
  const reasonText = reason?.trim() || "(no reason given)";

  // Each recipient gets a "Cancelled by:" line in their own frame of
  // reference: "you" when they themselves cancelled, or the
  // canceller's name (+ email) when the other party did. This avoids
  // the old "Cancelled by: the guest" line that left the host
  // wondering which guest it was.
  const guestBody = `The meeting scheduled for ${guestWhen} (${guestTz}) ` +
    `with ${config.hostName} has been cancelled.`;
  const hostBody =
    `The meeting scheduled for ${ownerWhen} (${booking.hostTz}) ` +
    `with ${booking.guestName} has been cancelled.`;
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
      }),
      html: cancellationHtml(config, {
        greeting: `Hi ${booking.guestName},`,
        body: guestBody,
        cancellerLabel: guestCancellerLabel,
        reason: reasonText,
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
      }),
      html: cancellationHtml(config, {
        greeting: `Hi ${config.hostName},`,
        body: hostBody,
        cancellerLabel: hostCancellerLabel,
        reason: reasonText,
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
  return [
    `Hi ${booking.guestName},`,
    "",
    `Your meeting with ${config.hostName} is booked.`,
    "",
    `When:  ${whenLong(booking, guestTimeZone(booking))}`,
    `Where: ${config.meetingUrl}`,
    "",
    "Add to calendar: open the attached .ics file.",
    "",
    `Need to cancel?`,
    cancelUrl,
    "",
    "— Sent by mig",
  ].join("\n");
}

function guestHtml(
  config: Config,
  booking: Booking,
  cancelUrl: string,
): string {
  return htmlWrap(
    config,
    `
    <p>Hi ${esc(booking.guestName)},</p>
    <p>Your meeting with <strong>${esc(config.hostName)}</strong> is booked.</p>
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">When</td>
          <td style="padding:4px 0">${
      esc(whenLong(booking, guestTimeZone(booking)))
    }</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Where</td>
          <td style="padding:4px 0"><a href="${
      esc(config.meetingUrl)
    }" style="color:#f97316">${esc(config.meetingUrl)}</a></td></tr>
    </table>
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
    `When:     ${whenLong(booking, booking.hostTz)}`,
  ];
  if (booking.notes?.trim()) {
    lines.push(`Notes:    ${booking.notes.trim()}`);
  }
  lines.push(
    `Booked at: ${booking.createdAt}`,
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
      esc(whenLong(booking, booking.hostTz))
    }</td></tr>
      ${notesHtml}
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Booked at</td>
          <td style="padding:4px 0">${esc(booking.createdAt)}</td></tr>
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
}): string {
  return [
    opts.greeting,
    "",
    opts.body,
    "",
    `Cancelled by: ${opts.cancellerLabel}`,
    `Reason: ${opts.reason}`,
    `Cancelled at: ${new Date().toISOString()}`,
    "",
    "— Sent by mig",
  ].join("\n");
}

function cancellationHtml(
  config: Config,
  opts: {
    greeting: string;
    body: string;
    cancellerLabel: string;
    reason: string;
  },
): string {
  return htmlWrap(
    config,
    `
    <p>${esc(opts.greeting.replace(/,$/, ""))},</p>
    <p>${esc(opts.body)}</p>
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Cancelled by</td>
          <td style="padding:4px 0">${esc(opts.cancellerLabel)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Reason</td>
          <td style="padding:4px 0">${esc(opts.reason)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Cancelled at</td>
          <td style="padding:4px 0">${esc(new Date().toISOString())}</td></tr>
    </table>
  `,
  );
}

function bookingInstant(booking: Booking): Date {
  return zonedDateTime(booking.date, booking.time, booking.hostTz);
}

function guestTimeZone(booking: Booking): string {
  return validTimeZoneOr(booking.guestTz, booking.hostTz);
}

function whenShort(booking: Booking, displayTz: string): string {
  return formatInstantShort(bookingInstant(booking), displayTz);
}

function whenLong(booking: Booking, displayTz: string): string {
  return formatInstantLong(bookingInstant(booking), displayTz) +
    ` (${displayTz})`;
}

function htmlWrap(config: Config, body: string): string {
  // Constrain to ~480px so the email reads as a letter, not a full
  // desktop pane. The body's dark background still extends to the
  // email-client viewport edges, which keeps the dark-mode look
  // clean without leaving the content dangling in whitespace.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#0f172a;color:#e2e8f0;
             font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
             font-size:16px;line-height:1.6">
<div style="max-width:480px;margin:0 auto">
  <div style="margin-bottom:16px">
    <a href="${
    esc(config.githubUrl)
  }" style="color:#f97316;font-weight:600;text-decoration:none">mig</a>
  </div>
  ${body}
  <p style="color:#64748b;font-size:14px;margin-top:24px">— Sent by <a href="${
    esc(config.githubUrl)
  }" style="color:#64748b;text-decoration:underline">mig</a></p>
</div>
</body></html>`;
}

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
