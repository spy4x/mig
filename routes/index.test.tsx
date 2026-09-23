// mig#15 review: without JavaScript, `/` used to list bare "09:00"
// slots with no indication of whose clock that was. The route now
// pre-labels every slot with the host's clock server-side (the same
// way /embed does when the visitor's zone is unknown), and a
// <noscript> block carries the "Times are shown in the host's
// timezone" line — visible only when JS never runs, so there's no
// flash for the common case where BookingFlow's hydration replaces
// it with the visitor's own labelled clock.

import { assert, assertEquals, assertFalse } from "@std/assert";
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

async function renderIndex(
  url: string,
  cfgOverrides: Partial<Config> = {},
): Promise<string> {
  const cfg = { ...fakeConfig(), ...cfgOverrides };
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

// mig#18 round 4 review: every other clock on this page converts into
// the visitor's zone once known, but the standalone time card's own
// date didn't — the island always built it from the host zone before
// mount, even when the server itself knew the visitor's zone from a
// `?tz=` query param. A unit test of the underlying formatter isn't
// enough here, because the island can stop calling it and nothing
// notices (that's exactly what happened: the date briefly came from
// noon instead of the slot's own instant, and every existing test —
// all unit tests of the formatter itself — stayed green). This
// exercises the real route + the real island's server-side render, the
// same way the two tests above do.
Deno.test("mig#18: the standalone time card shows the slot's date and clock in the tz query param's zone, not the host's", async () => {
  // 09:00 Monday 28 September in Ho Chi Minh (UTC+7) is 22:00 Sunday
  // 27 September in New York (UTC-4 in September) — a date-boundary
  // crossing, the case a noon-based date would get wrong.
  //
  // bookingHorizonDays is generously widened (not fakeConfig()'s 60)
  // so this stays bookable however much later than 2026-09-28 the
  // suite happens to run — the fixed test date itself is deliberate
  // (mig#18's brief), not something a clock/config mock should hide.
  const html = await renderIndex(
    "http://localhost/?date=2026-09-28&slot=09:00&tz=America/New_York",
    { bookingHorizonDays: 3650 },
  );
  // Scoped to the time card's own text — TimeCard.tsx renders
  // `{shownSlot} <span>· {dateLabel}</span>`. A whole-page
  // `html.includes(...)` would also pass if some other element on the
  // page happened to carry the right substring, so this extracts the
  // card's own two pieces instead (same technique as
  // routes/embed/embed.test.tsx's confirm-label test).
  const match = html.match(/(\d{2}:\d{2}, [^<·]+?)\s*<span[^>]*>·\s*([^<]+)</);
  assert(match, "expected the time card's clock + date markup");
  const [, clock, dateText] = match!;
  assertEquals(clock.trim(), "22:00, New York, UTC-4");
  assertEquals(dateText.trim(), "Sunday, 27 September 2026");
});

Deno.test("mig#18: the host-timezone <noscript> note is hidden when the tz query param sets a different zone", async () => {
  // The note claims "Times are shown in the host's timezone" — false
  // once a visitor arrives with a valid, non-host `?tz=`, since the
  // slot list (and everything else) then renders in *their* zone.
  const html = await renderIndex(
    "http://localhost/?tz=America/New_York",
    { bookingHorizonDays: 3650 },
  );
  assertFalse(
    html.includes("<noscript>"),
    "the host-timezone note must not render for a visitor with a different tz",
  );
});
