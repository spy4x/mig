// A booking saved before mig#57 with a date or time that does not exist
// still opens and cancels: /confirmed, /cancel and POST /api/cancel,
// including the cancellation emails.

import { assert, assertEquals } from "@std/assert";
import nodemailer from "nodemailer";
import { renderToString } from "preact-render-to-string";
import type { Context, PageProps } from "fresh";
import type { State } from "../../lib/utils.ts";
import type { Booking, Config } from "../../lib/types.ts";
import { BookingsStore } from "../../lib/bookings.ts";
import { MemoryRateLimiter } from "@spy4x/platform/rate-limit/memory";
import { parseWeeklyAvailability } from "../../lib/availability.ts";
import { newCancelToken } from "../../lib/tokens.ts";
import { setTransportForTesting } from "../../lib/email.ts";
import { loadConfirmedData } from "../../lib/confirmed-data.ts";
import CancelPage, { handler as cancelPage } from "../cancel.tsx";
import { handler } from "./cancel.ts";

const SECRET = "fake-cancel-secret-only-for-tests";

function fakeConfig(): Config {
  return {
    hostName: "Jane Doe",
    hostEmail: "jane@example.com",
    hostTz: "Europe/Berlin",
    meetingUrl: "https://meet.example.com/room",
    publicUrl: "https://mig.example.com",
    weeklyAvailability: parseWeeklyAvailability("MON-FRI 09:00-17:00"),
    slotDurationMin: 30,
    minNoticeHours: 6,
    bookingHorizonDays: 60,
    blockedDates: new Set<string>(),
    rateLimitPer5Min: 10,
    theme: "auto",
    smtp: {
      host: "smtp.example.com",
      port: 587,
      user: "jane@example.com",
      pass: "not-a-real-secret",
      from: "Bookings <book@example.com>",
    },
    cancelSecret: SECRET,
    port: 8080,
    dataPath: "/tmp/mig-api-cancel-test-unused.json",
    hideBranding: false,
    githubUrl: "https://github.com/spy4x/mig",
    version: "test",
  };
}

interface SentMail {
  data: { subject?: string };
  message: { getEnvelope(): unknown };
}

// On main, POST /api/book accepted date=2027-02-30 and slot=10:60 and
// told the visitor Tuesday 2 March 2027, 11:00. The record on disk kept
// the impossible values.
Deno.test("mig#57: a booking stored with an impossible date still opens and cancels, emails included", async () => {
  const cfg = fakeConfig();
  const path = `/tmp/mig-api-cancel-test-${crypto.randomUUID()}.json`;
  const { raw, hash } = await newCancelToken(SECRET);
  const stored: Booking = {
    id: "01JIMPOSSIBLEDATE00000000",
    createdAt: "2026-09-01T10:00:00.000Z",
    date: "2027-02-30",
    time: "10:60",
    hostTz: "Europe/Berlin",
    guestName: "Visitor",
    guestEmail: "visitor@example.com",
    cancelTokenHash: hash,
    status: "active",
  };
  await Deno.writeTextFile(path, JSON.stringify([stored]));
  const subjects: string[] = [];
  setTransportForTesting(nodemailer.createTransport({
    name: "recording-test-transport",
    version: "1.0.0",
    send(mail: SentMail, callback: (e: Error | null, info?: unknown) => void) {
      subjects.push(String(mail.data.subject));
      callback(null, { envelope: mail.message.getEnvelope() });
    },
  }));

  try {
    const bookings = new BookingsStore({ filePath: path });
    await bookings.init();
    const state = {
      config: cfg,
      bookings,
      rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
    };
    const query = `id=${stored.id}&token=${raw}`;

    const confirmed = await loadConfirmedData(
      {
        req: new Request(`http://localhost/confirmed?${query}`),
        state,
      } as unknown as Context<State>,
    );
    assertEquals(confirmed.state, "ok");
    assertEquals(confirmed.booking?.date, "2027-03-02");
    assertEquals(confirmed.booking?.time, "11:00");

    const cancelGet = await cancelPage.GET!(
      {
        req: new Request(`http://localhost/cancel?${query}`),
        state,
      } as unknown as Context<State>,
    );
    const data = (cancelGet as unknown as { data: unknown }).data;
    const html = renderToString(
      <CancelPage
        {...({
          data,
          state,
          url: new URL(`http://localhost/cancel?${query}`),
        } as unknown as PageProps<never, State>)}
      />,
    );
    assert(html.includes("Tuesday, 2 March 2027"), "cancel page date");

    const form = new URLSearchParams({ id: stored.id, token: raw });
    const res = await handler.POST!(
      {
        req: new Request("http://localhost/api/cancel", {
          method: "POST",
          body: form,
        }),
        state,
      } as unknown as Context<State>,
    ) as Response;

    assertEquals(res.status, 303);
    assertEquals(
      new URL(res.headers.get("location")!).searchParams.get("cancelled"),
      "1",
    );
    assertEquals(bookings.get(stored.id)?.status, "cancelled");
    assertEquals(subjects.length, 2);
    assert(
      subjects.every((s) => s.includes("Tue 2 Mar 11:00")),
      subjects.join(" | "),
    );
  } finally {
    setTransportForTesting(nodemailer.createTransport({ jsonTransport: true }));
    try {
      await Deno.remove(path);
    } catch {
      // ignore
    }
  }
});
