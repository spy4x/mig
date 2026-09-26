import type { SmtpTransport } from "@spy4x/email/smtp";
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildBookingEmails,
  buildCancellationEmails,
  sendBookingCorrectionEmail,
  sendEmail,
  setTransportForTesting,
} from "./email.ts";
import type { Booking, Config } from "./types.ts";

function makeConfig(): Config {
  return {
    hostName: "Host",
    hostEmail: "host@example.com",
    hostTz: "Europe/Berlin",
    meetingUrl: "https://meet.example.com/room",
    publicUrl: "https://mig.example.com",
    weeklyAvailability: {
      MON: [],
      TUE: [],
      WED: [],
      THU: [],
      FRI: [],
      SAT: [],
      SUN: [],
    },
    slotDurationMin: 30,
    minNoticeHours: 6,
    bookingHorizonDays: 14,
    blockedDates: new Set(),
    rateLimitPer5Min: 1,
    theme: "auto",
    smtp: {
      host: "smtp.example.com",
      port: 587,
      user: "user@example.com",
      pass: "placeholder",
      from: "Mig <mig@example.com>",
    },
    cancelSecret: "fake-cancel-secret-only-for-tests",
    port: 8080,
    dataPath: "./data/bookings.json",
    hideBranding: false,
    githubUrl: "https://github.com/spy4x/mig",
    version: "test",
  };
}

function makeBooking(guestTz?: string): Booking {
  return {
    id: "01HXYZBK8M",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "Europe/Berlin",
    guestTz,
    guestName: "Visitor",
    guestEmail: "visitor@example.com",
    cancelTokenHash: "hash",
    status: "active",
  };
}

Deno.test("booking emails use recipient timezones", () => {
  const emails = buildBookingEmails(
    makeConfig(),
    makeBooking("America/New_York"),
    "https://mig.example.com/cancel",
  );

  // Guest: only their own clock, never the host's raw IANA name.
  assertStringIncludes(emails.guest.subject, "04:00");
  assertStringIncludes(emails.guest.subject, "New York, UTC-4");
  assertStringIncludes(emails.guest.text, "04:00");
  assertStringIncludes(emails.guest.text, "New York, UTC-4");
  assertStringIncludes(
    emails.guest.attachments![0].content.replace(/\r\n[ \t]/g, ""),
    "New York",
  );
  // Owner: host clock plus the visitor's clock alongside it (mig#15).
  assertStringIncludes(emails.owner.subject, "10:00");
  assertStringIncludes(emails.owner.subject, "Berlin, UTC+2");
  assertStringIncludes(emails.owner.text, "10:00");
  assertStringIncludes(emails.owner.text, "Berlin, UTC+2");
  assertStringIncludes(emails.owner.text, "visitor: 04:00, New York, UTC-4");
  assertStringIncludes(
    emails.owner.attachments![0].content.replace(/\r\n[ \t]/g, ""),
    "Berlin",
  );
});

// mig#24 review follow-up: buildBookingEmails's ownerIcs used to pass
// only booking.hostTz through to generateIcs, so the owner's calendar
// invite showed the host clock alone even though the owner's email
// body (asserted above) already shows the visitor's clock alongside
// it. These three pin the invite to match.
Deno.test("owner invite ICS carries the visitor's clock alongside the host's", () => {
  const emails = buildBookingEmails(
    makeConfig(),
    makeBooking("America/New_York"),
    "https://mig.example.com/cancel",
  );
  const ownerIcs = emails.owner.attachments![0].content.replace(
    /\r\n[ \t]/g,
    "",
  );
  assertStringIncludes(ownerIcs, "10:00");
  assertStringIncludes(ownerIcs, "Berlin");
  assertStringIncludes(ownerIcs, "visitor: 04:00");
  assertStringIncludes(ownerIcs, "New York");
});

Deno.test("owner invite ICS shows the host clock alone when no visitor zone was captured", () => {
  const emails = buildBookingEmails(
    makeConfig(),
    makeBooking(undefined),
    "https://mig.example.com/cancel",
  );
  const ownerIcs = emails.owner.attachments![0].content.replace(
    /\r\n[ \t]/g,
    "",
  );
  assertStringIncludes(ownerIcs, "Berlin");
  assertEquals(ownerIcs.includes("visitor:"), false);
});

Deno.test("guest invite ICS is unaffected by the owner invite's visitor-clock change", () => {
  const emails = buildBookingEmails(
    makeConfig(),
    makeBooking("America/New_York"),
    "https://mig.example.com/cancel",
  );
  const guestIcs = emails.guest.attachments![0].content.replace(
    /\r\n[ \t]/g,
    "",
  );
  // Same DESCRIPTION time string the guest email itself shows — the
  // guest's own booking confirmation, never the owner's combined one.
  assertStringIncludes(guestIcs, "04:00");
  assertStringIncludes(guestIcs, "New York");
  assertEquals(guestIcs.includes("visitor:"), false);
});

Deno.test("cancellation emails use recipient timezones", () => {
  const emails = buildCancellationEmails(
    makeConfig(),
    makeBooking("America/New_York"),
    "guest",
    undefined,
  );

  assertStringIncludes(emails.guest.text, "04:00, New York, UTC-4");
  assertStringIncludes(emails.owner.text, "10:00, Berlin, UTC+2");
});

Deno.test("email output falls back for missing or invalid visitor timezone", () => {
  for (const guestTz of [undefined, "Not/A_Timezone"]) {
    const emails = buildBookingEmails(
      makeConfig(),
      makeBooking(guestTz),
      "https://mig.example.com/cancel",
    );

    assertStringIncludes(emails.guest.text, "10:00, Berlin, UTC+2");
    assertEquals(
      emails.guest.subject,
      "Booking confirmed: Fri 28 Aug 10:00, Berlin, UTC+2",
    );
    // No visitor zone known — the owner's email shows the host clock
    // alone, never a guessed visitor zone.
    assertEquals(
      emails.owner.text.includes("visitor:"),
      false,
      "owner email must not claim a visitor timezone that was never captured",
    );
  }
});

// ─── mig#15: two zones, two clocks ────────────────────────────────────
// Host in Ho Chi Minh (no DST, always UTC+7), guest in New York (EDT,
// UTC-4, unambiguous in October). This is the exact scenario from the
// issue: a 09:00 Tuesday slot in Ho Chi Minh is 22:00 Monday in New
// York.

function makeHoChiMinhConfig(): Config {
  return { ...makeConfig(), hostTz: "Asia/Ho_Chi_Minh" };
}

function makeCrossZoneBooking(): Booking {
  return {
    id: "01HXYZCROSSZONE",
    createdAt: "2026-10-01T00:00:00.000Z",
    date: "2026-10-06",
    time: "09:00",
    hostTz: "Asia/Ho_Chi_Minh",
    guestTz: "America/New_York",
    guestName: "Visitor",
    guestEmail: "visitor@example.com",
    cancelTokenHash: "hash",
    status: "active",
  };
}

Deno.test("mig#15: guest email (incl. subject) shows only the visitor's labelled clock", () => {
  const emails = buildBookingEmails(
    makeHoChiMinhConfig(),
    makeCrossZoneBooking(),
    "https://mig.example.com/cancel",
  );

  assertStringIncludes(emails.guest.subject, "New York, UTC-4");
  assertStringIncludes(emails.guest.subject, "22:00");
  assertStringIncludes(emails.guest.text, "22:00, New York, UTC-4");
  assertStringIncludes(emails.guest.html!, "22:00, New York, UTC-4");
});

Deno.test("mig#15: owner email shows both the host's and the visitor's labelled clock", () => {
  const emails = buildBookingEmails(
    makeHoChiMinhConfig(),
    makeCrossZoneBooking(),
    "https://mig.example.com/cancel",
  );

  for (const body of [emails.owner.text, emails.owner.html!]) {
    assertStringIncludes(body, "Ho Chi Minh, UTC+7");
    assertStringIncludes(body, "New York, UTC-4");
  }
});

Deno.test("mig#15 review: owner booking subject shows the visitor's clock and date, not just the host's", () => {
  // The reviewer's exact regression: the owner subject only ever
  // carried the host's own clock. Since the two dates differ here
  // (host Tuesday, visitor Monday evening), the visitor portion must
  // carry its own date too, not just a bare time.
  const emails = buildBookingEmails(
    makeHoChiMinhConfig(),
    makeCrossZoneBooking(),
    "https://mig.example.com/cancel",
  );
  assertStringIncludes(emails.owner.subject, "Ho Chi Minh, UTC+7");
  assertStringIncludes(
    emails.owner.subject,
    "visitor: Mon 5 Oct 22:00, New York, UTC-4",
  );
});

Deno.test("mig#15 review: owner cancellation subject and body show the visitor's clock", () => {
  const emails = buildCancellationEmails(
    makeHoChiMinhConfig(),
    makeCrossZoneBooking(),
    "guest",
    "changed my mind",
  );
  assertStringIncludes(emails.owner.subject, "Ho Chi Minh, UTC+7");
  assertStringIncludes(
    emails.owner.subject,
    "visitor: Mon 5 Oct 22:00, New York, UTC-4",
  );
  assertStringIncludes(emails.owner.text, "Ho Chi Minh, UTC+7");
  assertStringIncludes(
    emails.owner.text,
    "visitor: Mon 5 Oct 22:00, New York, UTC-4",
  );
});

Deno.test("mig#15 review: the owner cancellation subject never drops the host city (mutation guard)", () => {
  // Regression guard: a naive fix could rebuild the subject from just
  // guestWhen/ownerWhen strings and lose the host's own city+offset
  // if the concatenation order were ever changed carelessly.
  const emails = buildCancellationEmails(
    makeConfig(),
    makeBooking("America/New_York"),
    "owner",
    undefined,
  );
  assertStringIncludes(emails.owner.subject, "Berlin, UTC+2");
});

Deno.test("mig#15 review: no raw ISO timestamps in cancellation or booking emails", () => {
  const isoPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  const booking = buildBookingEmails(
    makeHoChiMinhConfig(),
    makeCrossZoneBooking(),
    "https://mig.example.com/cancel",
  );
  assertEquals(isoPattern.test(booking.owner.text), false, "Booked at");
  assertStringIncludes(booking.owner.text, "Booked at: Thu 1 Oct");

  const cancel = buildCancellationEmails(
    makeHoChiMinhConfig(),
    makeCrossZoneBooking(),
    "guest",
    "test",
  );
  assertEquals(
    isoPattern.test(cancel.guest.text),
    false,
    "guest Cancelled at",
  );
  assertEquals(
    isoPattern.test(cancel.owner.text),
    false,
    "owner Cancelled at",
  );
  // Guest reads their own zone, owner reads the host's — never a raw
  // timestamp with no zone attached.
  assertStringIncludes(cancel.guest.text, "New York, UTC-4");
  assertStringIncludes(cancel.owner.text, "Ho Chi Minh, UTC+7");
});

Deno.test("mig#15 review: guest email notes the host-timezone fallback when the guest zone is unknown", () => {
  const emails = buildBookingEmails(
    makeHoChiMinhConfig(),
    { ...makeCrossZoneBooking(), guestTz: undefined },
    "https://mig.example.com/cancel",
  );
  assertStringIncludes(
    emails.guest.text,
    "Times are shown in the host's timezone.",
  );
  assertStringIncludes(
    emails.guest.html!,
    "Times are shown in the host&#39;s timezone.",
  );
});

Deno.test("an apostrophe in a guest's name is escaped in the HTML email", () => {
  const emails = buildBookingEmails(
    makeHoChiMinhConfig(),
    { ...makeCrossZoneBooking(), guestName: "Dara O'Brien" },
    "https://mig.example.com/cancel",
  );
  assertStringIncludes(emails.owner.html!, "Dara O&#39;Brien");
  assertEquals(emails.owner.html!.includes("O'Brien"), false);
  assertStringIncludes(emails.owner.text, "Dara O'Brien");
});

// ─── mig#27: sendBookingCorrectionEmail must tell the truth about the rollback ──

interface RecordedMail {
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
}

/** Test-only transport: records every email sent to it and resolves
 *  each one immediately, no network I/O. */
function recordingTransport(sent: RecordedMail[]): SmtpTransport {
  return {
    sendMail(message) {
      sent.push({
        to: String(message.to),
        subject: message.subject,
        text: message.text === undefined ? undefined : String(message.text),
        html: message.html === undefined ? undefined : String(message.html),
      });
      return Promise.resolve({});
    },
  };
}

// mig#31: the round-3 reviewer of #30 changed several sentences in this
// email and every test stayed green — assertStringIncludes on fragments
// missed the drift. This test, and its rolledBack:false sibling below,
// each pin their rendered subject, text and HTML in full, against fixed
// inputs (makeBooking() has no guestTz, so formatOwnerClock never
// appends a "(visitor: ...)" suffix — one less moving part in the
// fixture).
Deno.test("sendBookingCorrectionEmail: rolledBack true pins the whole removed/free email", async () => {
  const sent: RecordedMail[] = [];
  setTransportForTesting(recordingTransport(sent));
  try {
    await sendBookingCorrectionEmail(makeConfig(), makeBooking(), {
      rolledBack: true,
    });
    assertEquals(sent.length, 1);
    assertEquals(
      sent[0].subject,
      "Not booked: Visitor, Fri 28 Aug 10:00, Berlin, UTC+2",
    );
    assertEquals(
      sent[0].text,
      `Hi Host,

The booking below was NOT created after all.

Guest: Visitor <visitor@example.com>
When:  Friday, 28 August 2026 at 10:00, Berlin, UTC+2

The guest's confirmation email failed to send, so the booking was removed and the slot is free again. Please disregard the "New booking" email and calendar invite you received a moment ago.

— Sent by mig`,
    );
    assertEquals(
      sent[0].html,
      `<!doctype html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#0f172a;color:#e2e8f0;
             font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
             font-size:16px;line-height:1.6">
<div style="max-width:480px;margin:0 auto">
<div style="margin-bottom:16px"><a href="https://github.com/spy4x/mig" style="color:#f97316;font-weight:600;text-decoration:none">mig</a></div>

    <p>Hi Host,</p>
    <p>The booking below was <strong>NOT</strong> created after all.</p>
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Guest</td>
          <td style="padding:4px 0">Visitor &lt;visitor@example.com&gt;</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">When</td>
          <td style="padding:4px 0">Friday, 28 August 2026 at 10:00, Berlin, UTC+2</td></tr>
    </table>
    <p>The guest's confirmation email failed to send, so the booking
    was removed and the slot is free again. Please disregard the
    &ldquo;New booking&rdquo; email and calendar invite you received a
    moment ago.</p>
  
<p style="color:#64748b;font-size:14px;margin-top:24px">— Sent by <a href="https://github.com/spy4x/mig" style="color:#64748b;text-decoration:underline">mig</a></p>

</div>
</body></html>`,
    );
  } finally {
    setTransportForTesting(null);
  }
});

Deno.test("sendBookingCorrectionEmail: rolledBack false pins the whole not-removed email", async () => {
  const sent: RecordedMail[] = [];
  setTransportForTesting(recordingTransport(sent));
  try {
    const booking = makeBooking();
    await sendBookingCorrectionEmail(makeConfig(), booking, {
      rolledBack: false,
    });
    assertEquals(sent.length, 1);
    const text = sent[0].text ?? "";
    const html = sent[0].html ?? "";
    assertEquals(
      sent[0].subject,
      "Not booked, remove by hand: Visitor, Fri 28 Aug 10:00, Berlin, UTC+2",
    );
    assertEquals(
      text,
      `Hi Host,

The booking below was NOT confirmed.

Guest: Visitor <visitor@example.com>
When:  Friday, 28 August 2026 at 10:00, Berlin, UTC+2

The guest's confirmation email failed to send, and removing the booking failed too. It may still be on disk and come back after a restart. Remove it by hand: booking id 01HXYZBK8M in the data file. Please disregard the "New booking" email and calendar invite you received a moment ago.

— Sent by mig`,
    );
    assertEquals(
      html,
      `<!doctype html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#0f172a;color:#e2e8f0;
             font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
             font-size:16px;line-height:1.6">
<div style="max-width:480px;margin:0 auto">
<div style="margin-bottom:16px"><a href="https://github.com/spy4x/mig" style="color:#f97316;font-weight:600;text-decoration:none">mig</a></div>

    <p>Hi Host,</p>
    <p>The booking below was <strong>NOT</strong> confirmed.</p>
    <table style="border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">Guest</td>
          <td style="padding:4px 0">Visitor &lt;visitor@example.com&gt;</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#94a3b8">When</td>
          <td style="padding:4px 0">Friday, 28 August 2026 at 10:00, Berlin, UTC+2</td></tr>
    </table>
    <p>The guest's confirmation email failed to send, and removing
    the booking failed too. It may still be on disk and come back
    after a restart. Remove it by hand: booking id 01HXYZBK8M in the data file. Please disregard the &ldquo;New
    booking&rdquo; email and calendar invite you received a moment
    ago.</p>
  
<p style="color:#64748b;font-size:14px;margin-top:24px">— Sent by <a href="https://github.com/spy4x/mig" style="color:#64748b;text-decoration:underline">mig</a></p>

</div>
</body></html>`,
    );
    assertEquals(/removed|free/i.test(text), false, `text: ${text}`);
    assertEquals(/removed|free/i.test(html), false, `html: ${html}`);
    // The HTML wraps "NOT" in <strong>...</strong>, so a plain
    // substring check on "NOT created" would never match either way —
    // the text regex allows only whitespace between "not" and
    // "created" (there is none in the text template), while the HTML
    // one also allows tags, so both actually exercise the wording
    // instead of the markup around it.
    assertEquals(/not\s*created/i.test(text), false, `text: ${text}`);
    assertEquals(
      /not(<[^>]+>|\s)*created/i.test(html),
      false,
      `html: ${html}`,
    );
    // mig#31: the host's only cue, when NTFY is off, to disregard the
    // earlier "New booking" email and clean up the stray booking by
    // hand — the assertEquals calls above already pin these exact
    // phrases as part of the whole email, but each gets its own
    // explicit, case-insensitive check too, in both text and HTML, so
    // dropping any one of them turns this test red on its own even if
    // a future edit also changes surrounding wording.
    assertStringIncludes(text.toLowerCase(), "disregard");
    assertStringIncludes(html.toLowerCase(), "disregard");
    assertStringIncludes(text.toLowerCase(), "remove it by hand");
    assertStringIncludes(html.toLowerCase(), "remove it by hand");
  } finally {
    setTransportForTesting(null);
  }
});

Deno.test("sendBookingCorrectionEmail: rolledBack false HTML-escapes the booking id", async () => {
  const sent: RecordedMail[] = [];
  setTransportForTesting(recordingTransport(sent));
  try {
    const booking = { ...makeBooking(), id: `id<&">` };
    await sendBookingCorrectionEmail(makeConfig(), booking, {
      rolledBack: false,
    });
    assertEquals(sent.length, 1);
    const html = sent[0].html ?? "";
    assertStringIncludes(html, "id&lt;&amp;&quot;&gt;");
    assertEquals(html.includes(booking.id), false, `html: ${html}`);
  } finally {
    setTransportForTesting(null);
  }
});

Deno.test("a failed send never carries the SMTP password in its error", async () => {
  const config = makeConfig();
  const pass = "not-a-real-password-0123";
  setTransportForTesting({
    sendMail: () =>
      Promise.reject(new Error(`535 auth failed for user:${pass} (${pass})`)),
  });
  try {
    const sent = await sendEmail(
      { ...config, smtp: { ...config.smtp, pass } },
      { to: "visitor@example.com", subject: "Hi", text: "Hi" },
    );
    assertEquals(sent.ok, false);
    if (sent.ok) return;
    assertEquals(sent.error.includes(pass), false, sent.error);
    assertStringIncludes(sent.error, "<REDACTED:CREDENTIAL>");
  } finally {
    setTransportForTesting(null);
  }
});

Deno.test("a send the transport rejects returns a failed result instead of throwing", async () => {
  setTransportForTesting({
    sendMail: () => Promise.reject(new Error("connection refused")),
  });
  try {
    const sent = await sendEmail(makeConfig(), {
      to: "visitor@example.com",
      subject: "Hi",
      text: "Hi",
    });
    assertEquals(sent.ok, false);
    if (!sent.ok) assertStringIncludes(sent.error, "connection refused");
  } finally {
    setTransportForTesting(null);
  }
});

Deno.test("the invite attachment's Content-Type carries a charset and the calendar's METHOD", () => {
  const emails = buildBookingEmails(
    makeHoChiMinhConfig(),
    makeCrossZoneBooking(),
    "https://mig.example.com/cancel",
  );
  for (const email of [emails.guest, emails.owner]) {
    const [invite] = email.attachments ?? [];
    assertEquals(invite.filename, "meeting.ics");
    assertEquals(
      invite.contentType,
      "text/calendar; charset=utf-8; method=REQUEST",
    );
    assertStringIncludes(invite.content, "METHOD:REQUEST");
  }
});
