// mig#15 — the cancel page shows the same visitor-facing clock as
// /confirmed: converted into the visitor's zone when known, labelled
// with city + offset, and falling back to the labelled host clock
// (plus a one-line note) when no visitor zone was captured. Calls the
// route's default component directly with hand-built props, the same
// pattern routes/embed/embed.test.tsx uses.

import { assert, assertFalse } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import type { PageProps } from "fresh";
import type { State } from "../lib/utils.ts";
import type { Config } from "../lib/types.ts";
import CancelPage from "./cancel.tsx";

const FAKE_CONFIG: Config = {
  hostName: "Jane Doe",
  hostEmail: "jane@example.com",
  hostTz: "Asia/Ho_Chi_Minh",
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
  bookingHorizonDays: 60,
  blockedDates: new Set<string>(),
  rateLimitPer5Min: 1,
  theme: "auto",
  smtp: {
    host: "smtp.example.com",
    port: 587,
    user: "jane@example.com",
    pass: "not-a-real-secret",
    from: "Bookings <book@example.com>",
  },
  cancelSecret: "fake-cancel-secret-only-for-tests",
  port: 8080,
  dataPath: "/tmp/mig-cancel-test-unused.json",
  hideBranding: false,
  githubUrl: "https://github.com/spy4x/mig",
  version: "test",
};

// `CancelData` isn't exported from routes/cancel.tsx (it's a route-local
// type), so `fakePageProps` stays generic — same shape as
// routes/embed/embed.test.tsx's helper — and each call site's object
// literal is checked structurally against whichever union member its
// `state: "ok" as const` picks out.
function fakePageProps<Data>(data: Data): PageProps<Data, State> {
  const req = new Request("http://localhost/cancel");
  return {
    data,
    state: { config: FAKE_CONFIG } as unknown as State,
    config: {} as unknown as PageProps<Data, State>["config"],
    url: new URL(req.url),
    req,
    params: {},
    info: {} as unknown as PageProps<Data, State>["info"],
    isPartial: false,
    Component: (() => null) as unknown as PageProps<Data, State>["Component"],
    error: null,
    route: null,
  };
}

Deno.test("mig#15: cancel page shows the visitor's converted, labelled clock", () => {
  const html = renderToString(
    <CancelPage
      {...fakePageProps({
        state: "ok" as const,
        booking: {
          id: "01JBOOKINGFAKE00000000000",
          date: "2026-10-06",
          time: "09:00",
          hostTz: "Asia/Ho_Chi_Minh",
          guestTz: "America/New_York",
          guestName: "Visitor",
        },
        token: "faketoken",
        cancelledAt: null,
        hostTz: "Asia/Ho_Chi_Minh",
        guestTz: "America/New_York",
      })}
    />,
  );
  assert(html.includes("22:00, New York, UTC-4"));
  assert(html.includes("Monday, 5 October 2026"));
  assertFalse(html.includes("09:00, Ho Chi Minh"));
  assertFalse(html.includes("host&#39;s timezone"));
});

Deno.test("mig#15: cancel page falls back to the labelled host clock when no visitor zone was captured", () => {
  const html = renderToString(
    <CancelPage
      {...fakePageProps({
        state: "ok" as const,
        booking: {
          id: "01JBOOKINGFAKE00000000000",
          date: "2026-10-06",
          time: "09:00",
          hostTz: "Asia/Ho_Chi_Minh",
          guestTz: null,
          guestName: "Visitor",
        },
        token: "faketoken",
        cancelledAt: null,
        hostTz: "Asia/Ho_Chi_Minh",
        guestTz: null,
      })}
    />,
  );
  assert(html.includes("09:00, Ho Chi Minh, UTC+7"));
  assert(
    html.includes("Times are shown in the host&#39;s timezone."),
    "expected the host-timezone fallback note",
  );
});

// ─── mig#15 round 2: "already cancelled" no longer uses the server's own zone ──
// This used to format `cancelledAt` with `Date.toLocaleString()`, which
// reads the *server process's* zone — not the visitor's, not the
// host's. Every assertion below passes an explicit zone through
// hostTz/guestTz instead, so the result is identical no matter what
// zone the Deno process itself happens to be running in; running with
// `TZ=UTC` (or any other zone) makes no difference, which is the
// actual regression test.

Deno.test("mig#15 round 2: already-cancelled shows the visitor's dated, labelled clock — not the server's own zone", () => {
  const html = renderToString(
    <CancelPage
      {...fakePageProps({
        state: "already-cancelled" as const,
        booking: null,
        token: null,
        // 2026-10-06T02:00:00Z = 09:00 Ho Chi Minh = 22:00 the
        // previous day (5 Oct) in New York.
        cancelledAt: "2026-10-06T02:00:00.000Z",
        hostTz: "Asia/Ho_Chi_Minh",
        guestTz: "America/New_York",
      })}
    />,
  );
  assert(
    html.includes("cancelled on Mon 5 Oct 22:00, New York, UTC-4"),
    "expected the visitor's dated, labelled clock in the message",
  );
  assertFalse(html.includes("Ho Chi Minh"));
  assertFalse(html.includes("host&#39;s timezone"));
});

Deno.test("mig#15 round 2: already-cancelled falls back to the host's dated, labelled clock plus the note", () => {
  const html = renderToString(
    <CancelPage
      {...fakePageProps({
        state: "already-cancelled" as const,
        booking: null,
        token: null,
        cancelledAt: "2026-10-06T02:00:00.000Z",
        hostTz: "Asia/Ho_Chi_Minh",
        guestTz: null,
      })}
    />,
  );
  assert(
    html.includes("cancelled on Tue 6 Oct 09:00, Ho Chi Minh, UTC+7"),
    "expected the host's dated, labelled clock in the message",
  );
  assert(
    html.includes("Times are shown in the host&#39;s timezone."),
    "expected the host-timezone fallback note",
  );
});
