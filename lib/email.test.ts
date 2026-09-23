import { assertEquals, assertStringIncludes } from "@std/assert";
import nodemailer from "nodemailer";
import {
  buildBookingEmails,
  buildCancellationEmails,
  sendBookingCorrectionEmail,
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
    cancelSecret: "placeholder",
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
    "Times are shown in the host's timezone.",
  );
});

// ─── mig#27: sendBookingCorrectionEmail must tell the truth about the rollback ──

interface RecordedMail {
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
}

/** Test-only transport: records every email sent to it and resolves
 *  each one immediately, no network I/O — a custom `send()` transport,
 *  same "recording transport" spirit as lib/book.test.ts's
 *  recordingTransport (which is also not jsonTransport-backed). */
function recordingTransport(sent: RecordedMail[]) {
  return nodemailer.createTransport({
    name: "email-test-recording-transport",
    version: "1.0.0",
    send(
      mail: { data: RecordedMail; message: { getEnvelope(): unknown } },
      callback: (err: Error | null, info?: unknown) => void,
    ) {
      sent.push({
        to: mail.data.to,
        subject: mail.data.subject,
        text: mail.data.text,
        html: mail.data.html,
      });
      callback(null, { envelope: mail.message.getEnvelope() });
    },
  });
}

Deno.test("sendBookingCorrectionEmail: rolledBack true keeps the removed/free wording unchanged", async () => {
  const sent: RecordedMail[] = [];
  setTransportForTesting(recordingTransport(sent));
  try {
    await sendBookingCorrectionEmail(makeConfig(), makeBooking(), {
      rolledBack: true,
    });
    assertEquals(sent.length, 1);
    assertStringIncludes(sent[0].subject ?? "", "Not booked:");
    assertStringIncludes(
      sent[0].text ?? "",
      "The booking below was NOT created after all.",
    );
    assertStringIncludes(
      sent[0].text ?? "",
      "was removed and the slot is free again",
    );
    assertStringIncludes(
      sent[0].html ?? "",
      "was removed and the slot is free again",
    );
  } finally {
    setTransportForTesting(null);
  }
});

Deno.test("sendBookingCorrectionEmail: rolledBack false does not claim the booking was removed or the slot is free", async () => {
  const sent: RecordedMail[] = [];
  setTransportForTesting(recordingTransport(sent));
  try {
    const booking = makeBooking();
    await sendBookingCorrectionEmail(makeConfig(), booking, {
      rolledBack: false,
    });
    assertEquals(sent.length, 1);
    assertStringIncludes(sent[0].subject ?? "", "Not booked, remove by hand:");
    const text = sent[0].text ?? "";
    const html = sent[0].html ?? "";
    assertEquals(/removed|free/i.test(text), false, `text: ${text}`);
    assertEquals(/removed|free/i.test(html), false, `html: ${html}`);
    // The HTML wraps "NOT" in <strong>...</strong>, so a plain
    // substring check on "NOT created" would never match either way —
    // these allow markup (or a single space) between "not" and
    // "created" so the assertion actually exercises the wording.
    assertEquals(/not\s*created/i.test(text), false, `text: ${text}`);
    assertEquals(
      /not(<[^>]+>|\s)*created/i.test(html),
      false,
      `html: ${html}`,
    );
    assertStringIncludes(text, booking.id);
    assertStringIncludes(html, booking.id);
    assertStringIncludes(text.toLowerCase(), "remove it by hand");
    assertStringIncludes(text, '"New booking"');
    assertStringIncludes(text, "after a restart");
    assertStringIncludes(html, "after a restart");
    assertStringIncludes(html, "disregard");
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
