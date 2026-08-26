// SMTP via nodemailer. Sends multipart/alternative (text + HTML) emails,
// optionally with an ICS attachment.

import nodemailer from "nodemailer";
import type { Config } from "./types.ts";
import type { Booking } from "./types.ts";
import { generateIcs } from "./ics.ts";
import { formatDateTimeShort } from "./tz.ts";

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
  const ics = generateIcs(booking, config, cancelUrl);
  const when = formatDateTimeShort(booking.date, booking.time, booking.hostTz);

  await sendEmail(config, {
    to: booking.guestEmail,
    subject: `Booking confirmed: ${when}`,
    text: guestText(config, booking, cancelUrl),
    html: guestHtml(config, booking, cancelUrl),
    attachments: [
      {
        filename: "meeting.ics",
        content: ics,
        contentType: "text/calendar; method=REQUEST",
      },
    ],
  });

  await sendEmail(config, {
    to: config.hostEmail,
    subject: `New booking: ${booking.guestName} on ${when}`,
    text: ownerText(config, booking, cancelUrl),
    html: ownerHtml(config, booking, cancelUrl),
    attachments: [
      {
        filename: "meeting.ics",
        content: ics,
        contentType: "text/calendar; method=REQUEST",
      },
    ],
  });
}

export async function sendCancellationEmails(
  config: Config,
  booking: Booking,
  cancelledBy: "owner" | "guest",
  reason: string | undefined,
): Promise<void> {
  const when = formatDateTimeShort(booking.date, booking.time, booking.hostTz);
  const reasonText = reason?.trim() || "(no reason given)";

  // Each recipient gets a "Cancelled by:" line in their own frame of
  // reference: "you" when they themselves cancelled, or the
  // canceller's name (+ email) when the other party did. This avoids
  // the old "Cancelled by: the guest" line that left the host
  // wondering which guest it was.
  const guestBody = `The meeting scheduled for ${when} (${booking.hostTz}) ` +
    `with ${config.hostName} has been cancelled.`;
  const hostBody = `The meeting scheduled for ${when} (${booking.hostTz}) ` +
    `with ${booking.guestName} has been cancelled.`;
  const guestCancellerLabel = cancelledBy === "guest"
    ? "you"
    : `${config.hostName}`;
  const hostCancellerLabel = cancelledBy === "guest"
    ? `${booking.guestName} <${booking.guestEmail}>`
    : "you";

  await sendEmail(config, {
    to: booking.guestEmail,
    subject: `Your booking on ${when} was cancelled`,
    text: cancellationText({
      greeting: `Hi ${booking.guestName},`,
      body: guestBody,
      cancellerLabel: guestCancellerLabel,
      reason: reasonText,
    }),
    html: cancellationHtml({
      greeting: `Hi ${booking.guestName},`,
      body: guestBody,
      cancellerLabel: guestCancellerLabel,
      reason: reasonText,
    }),
  });

  await sendEmail(config, {
    to: config.hostEmail,
    subject: `Booking cancelled: ${booking.guestName}, ${when}`,
    text: cancellationText({
      greeting: `Hi ${config.hostName},`,
      body: hostBody,
      cancellerLabel: hostCancellerLabel,
      reason: reasonText,
    }),
    html: cancellationHtml({
      greeting: `Hi ${config.hostName},`,
      body: hostBody,
      cancellerLabel: hostCancellerLabel,
      reason: reasonText,
    }),
  });
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
    `When:  ${whenLong(booking)}`,
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
  return htmlWrap(`
    <p>Hi ${esc(booking.guestName)},</p>
    <p>Your meeting with <strong>${esc(config.hostName)}</strong> is booked.</p>
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">When</td>
          <td style="padding:4px 0">${esc(whenLong(booking))}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Where</td>
          <td style="padding:4px 0"><a href="${
    esc(config.meetingUrl)
  }" style="color:#f97316">${esc(config.meetingUrl)}</a></td></tr>
    </table>
    <p>Add to calendar: open the attached <code>.ics</code> file.</p>
    <p>Need to cancel? <a href="${
    esc(cancelUrl)
  }" style="color:#f97316">Cancel booking</a></p>
    <p style="color:#64748b;font-size:14px">— Sent by mig</p>
  `);
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
    `When:     ${whenLong(booking)}`,
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
  _config: Config,
  booking: Booking,
  cancelUrl: string,
): string {
  const notesHtml = booking.notes?.trim()
    ? `<tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Notes</td>
          <td style="padding:4px 0;white-space:pre-wrap">${
      esc(booking.notes.trim())
    }</td></tr>`
    : "";
  return htmlWrap(`
    <p>New booking received.</p>
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Guest</td>
          <td style="padding:4px 0">${esc(booking.guestName)} &lt;${
    esc(booking.guestEmail)
  }&gt;</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">When</td>
          <td style="padding:4px 0">${esc(whenLong(booking))}</td></tr>
      ${notesHtml}
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Booked at</td>
          <td style="padding:4px 0">${esc(booking.createdAt)}</td></tr>
    </table>
    <p><a href="${
    esc(cancelUrl)
  }" style="color:#f97316">Cancel this booking</a></p>
    <p style="color:#64748b;font-size:14px">— Sent by mig</p>
  `);
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

function cancellationHtml(opts: {
  greeting: string;
  body: string;
  cancellerLabel: string;
  reason: string;
}): string {
  return htmlWrap(`
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
    <p style="color:#64748b;font-size:14px">— Sent by mig</p>
  `);
}

function whenLong(booking: Booking): string {
  return formatDateTimeShort(booking.date, booking.time, booking.hostTz) +
    ` (${booking.hostTz})`;
}

function htmlWrap(body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#0f172a;color:#e2e8f0;
             font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
             font-size:16px;line-height:1.6">
<div style="max-width:560px;margin:0 auto">
  <div style="color:#f97316;font-weight:600;margin-bottom:16px">mig</div>
  ${body}
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
