// mig#15 review: without JavaScript, `/` used to list bare "09:00"
// slots with no indication of whose clock that was. The route now
// pre-labels every slot with the host's clock server-side (the same
// way /embed does when the visitor's zone is unknown), and a
// <noscript> block carries the "Times are shown in the host's
// timezone" line — visible only when JS never runs, so there's no
// flash for the common case where BookingFlow's hydration replaces
// it with the visitor's own labelled clock.

import { assert, assertFalse } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import type { Context } from "fresh";
import type { State } from "../lib/utils.ts";
import type { Config } from "../lib/types.ts";
import { BookingsStore } from "../lib/bookings.ts";
import { RateLimiter } from "../lib/ratelimit.ts";
import { parseWeeklyAvailability } from "../lib/availability.ts";
import Index from "./index.tsx";

const HOST_TZ = "Asia/Ho_Chi_Minh";
const TEST_DATE = "2026-10-06"; // Tuesday, within MON-FRI 09:00-17:00

function fakeConfig(): Config {
  return {
    hostName: "Jane Doe",
    hostEmail: "jane@example.com",
    hostTz: HOST_TZ,
    meetingUrl: "https://meet.example.com/room",
    publicUrl: "https://mig.example.com",
    weeklyAvailability: parseWeeklyAvailability("MON-FRI 09:00-17:00"),
    slotDurationMin: 30,
    minNoticeHours: 1,
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
    cancelSecret: "fake-cancel-secret-only-for-tests",
    port: 8080,
    dataPath: "/tmp/mig-index-test-unused.json",
    hideBranding: false,
    githubUrl: "https://github.com/spy4x/mig",
    version: "test",
  };
}

async function renderIndex(url: string): Promise<string> {
  const cfg = fakeConfig();
  const path = `/tmp/mig-index-test-${crypto.randomUUID()}.json`;
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  try {
    const req = new Request(url);
    const ctx = {
      req,
      url: new URL(url),
      state: {
        config: cfg,
        bookings,
        rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
      },
      params: {},
      config: {},
      info: {},
      isPartial: false,
      Component: () => null,
      error: null,
      route: null,
    } as unknown as Context<State>;
    // deno-lint-ignore no-explicit-any
    return renderToString((Index as any)(ctx));
  } finally {
    try {
      await Deno.remove(path);
    } catch {
      // ignore
    }
  }
}

Deno.test("mig#15: standalone / labels every slot with the host's clock server-side, not bare HH:MM", async () => {
  const html = await renderIndex(`http://localhost/?date=${TEST_DATE}`);
  assert(
    html.includes("09:00, Ho Chi Minh, UTC+7"),
    "expected the 09:00 slot to render the host's labelled clock",
  );
  // A bare, unlabelled ">09:00<" anywhere would mean the fix regressed
  // — every slot must carry its city and offset.
  assertFalse(
    />09:00</.test(html),
    "must not render a bare, unlabelled slot time",
  );
});

Deno.test("mig#15: standalone / carries a <noscript> host-timezone fallback note", async () => {
  const html = await renderIndex("http://localhost/");
  assert(
    html.includes("<noscript>"),
    "expected a <noscript> block for the no-JS fallback",
  );
  assert(
    html.includes("Times are shown in the host&#39;s timezone."),
    "expected the host-timezone fallback note inside it",
  );
});
