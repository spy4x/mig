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
import { MemoryRateLimiter } from "@spy4x/platform/rate-limit/memory";
import { parseWeeklyAvailability } from "../lib/availability.ts";
import { addDays, dayOfWeek, isoDateInTz } from "@spy4x/time/tz";
import Index from "./index.tsx";

const HOST_TZ = "Asia/Ho_Chi_Minh";
const TEST_DATE = "2026-10-06"; // Tuesday, within MON-FRI 09:00-17:00

/** A bookable weekday at least `daysAhead` days out, computed from
 *  whenever the suite actually runs — same helper as lib/book.test.ts's
 *  futureWeekday, needed here too so a test isn't pinned to a literal
 *  date that eventually lands in the past (see the slot-link test
 *  below). */
function futureWeekday(daysAhead: number, tz: string): string {
  let d = addDays(isoDateInTz(new Date(), tz), daysAhead, tz);
  while (dayOfWeek(d, tz) === "SAT" || dayOfWeek(d, tz) === "SUN") {
    d = addDays(d, 1, tz);
  }
  return d;
}

// mig#48 review: scoped to TimeSlots.tsx's own header element
// (`<p class="text-xs text-ink-subtle mt-0.5">{zoneLabel}</p>`) —
// never a whole-page `html.includes(...)`, since the same zone string
// also appears (correctly) inside every slot's `aria-label`; an
// `includes` check would keep passing even if the header itself were
// removed. `null` when the header isn't rendered at all.
function gridHeaderZoneLabel(html: string): string | null {
  const m = html.match(
    /<p class="text-xs text-ink-subtle mt-0\.5">([^<]*)<\/p>/,
  );
  return m ? m[1] : null;
}

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
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
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

Deno.test("mig#48: standalone / shows the host's zone once above the grid, and each slot's own labelled clock in its accessible name", async () => {
  const html = await renderIndex(`http://localhost/?date=${TEST_DATE}`);
  // The zone renders once, in the grid header element itself.
  assertEquals(
    gridHeaderZoneLabel(html),
    "Ho Chi Minh, UTC+7",
    "expected the grid header element to show the host's zone",
  );
  // The slot's own accessible name still carries the full labelled
  // clock (mig#15's rule), even though the visible text is now bare.
  assert(
    html.includes('aria-label="09:00, Ho Chi Minh, UTC+7"'),
    "expected the 09:00 slot's accessible name to carry the full clock",
  );
  // The visible slot text itself is bare HH:MM now that the zone
  // lives in the header — a regression back to repeating the zone on
  // every slot wouldn't be caught by the header assertion above (the
  // header element itself would be unaffected by that regression);
  // this catches it instead, since the visible text would then read
  // "09:00, Ho Chi Minh, UTC+7" rather than bare "09:00".
  assert(
    />09:00</.test(html),
    "expected the slot's visible text to be bare HH:MM",
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

// mig#18 review follow-up: a reviewer removed `tz` from every link
// BookingFlow's children render (and from pushUrl) and every existing
// test stayed green — nothing asserted the no-JS / pre-hydration slot
// links actually carry it. This renders the real route + island, the
// same technique as the tests above, and is scoped to a slot link's
// own `href` rather than a whole-page `includes` — the tz query param
// also shows up (correctly) elsewhere on the page (the date card),
// so a whole-page check wouldn't catch the link this tz actually
// needs to survive on: the one a no-JS visitor clicks to advance the
// flow.
Deno.test("mig#18: standalone / keeps tz on every slot link", async () => {
  // review follow-up: a past date renders its slots disabled and
  // without links, so the loop below would never run — this test
  // computes a bookable weekday relative to whenever the suite
  // actually runs, the same way lib/book.test.ts's futureWeekday does.
  const date = futureWeekday(3, HOST_TZ);
  const html = await renderIndex(
    `http://localhost/?date=${date}&tz=America/New_York`,
  );
  // A single `html.match` (no `g` flag) only ever checks the *first*
  // slot link — a mutation that dropped `tz` from every link except
  // the first would have stayed green. `matchAll` with `g` collects
  // every slot link's `href` so all of them are checked, not just one.
  const slotLinks = [...html.matchAll(/href="([^"]*slot=[^"]*)"/g)].map((
    m,
  ) => m[1]);
  // Guards against the vacuous pass above: an empty page (wrong date,
  // broken availability config, a future regression in this test
  // itself) must fail loudly instead of the `for` loop below silently
  // running zero times and reporting success.
  assert(
    slotLinks.length > 0,
    `expected at least one slot link in the rendered HTML, got ${slotLinks.length}`,
  );
  for (const href of slotLinks) {
    assert(
      href.includes("tz=America%2FNew_York"),
      `expected every slot link to carry tz=, got "${href}"`,
    );
  }
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

Deno.test("mig#48 review: the header comes from the FIRST slot, so only a LATER slot whose offset disagrees shows its own inline", async () => {
  // Europe/Berlin's DST ends 2026-10-25 at 03:00 CEST -> 02:00 CET —
  // a real transition where the offset itself changes, from UTC+2 to
  // UTC+1, at 01:00 UTC. The host (Ho Chi Minh, UTC+7, no DST) has an
  // unusually early Sunday window so the visible grid straddles that
  // instant once converted to Berlin: 06:00 host-local (the first
  // slot) lands at 01:00 Berlin (still UTC+2, pre-transition), 08:00
  // onward lands at 02:00+ Berlin (already UTC+1).
  const html = await renderIndex(
    "http://localhost/?date=2026-10-25&tz=Europe/Berlin",
    {
      weeklyAvailability: parseWeeklyAvailability("SUN 06:00-10:00"),
      bookingHorizonDays: 3650,
    },
  );
  // The header comes from the FIRST slot shown (06:00 host, 01:00
  // Berlin, UTC+2) — not an arbitrary anchor like noon of the host
  // day, which would land after the transition (UTC+1) even though no
  // visible slot at that hour has actually made it there yet.
  assertEquals(
    gridHeaderZoneLabel(html),
    "Berlin, UTC+2",
    "expected the grid header to come from the first slot's own offset",
  );
  // The 06:00 host slot (01:00 Berlin, UTC+2) agrees with the header
  // it defines, so it shows bare HH:MM only.
  assert(
    html.includes('aria-label="01:00, Berlin, UTC+2"'),
    "expected the first slot's accessible name to carry the header's offset",
  );
  assert(
    />01:00</.test(html),
    "expected the first slot to show bare HH:MM (its own offset matches the header)",
  );
  // The 09:00 host slot (03:00 Berlin, UTC+1) disagrees with the
  // header, so it shows its own offset inline, alongside its full
  // accessible name.
  assert(
    html.includes('aria-label="03:00, Berlin, UTC+1"'),
    "expected the post-transition slot's accessible name to carry its own offset",
  );
  assert(
    />03:00, UTC\+1</.test(html),
    "expected the post-transition slot to show its own offset inline",
  );
});

// ─── mig#57: dates and times that do not exist ───────────────────────

// @spy4x/time/tz's zonedDateTime throws on "2026-02-31" and "24:00"
// where mig's own copy rolled them over. The page drops both params,
// as it does any malformed one, and still renders.
Deno.test("mig#57: standalone / ignores a date or slot param that is not on the calendar", async () => {
  const badDate = await renderIndex("http://localhost/?date=2026-02-31");
  assertEquals(gridHeaderZoneLabel(badDate), null);
  assertFalse(badDate.includes("2026-02-31"));

  const badSlot = await renderIndex(
    `http://localhost/?date=${TEST_DATE}&slot=24:00`,
  );
  assert(badSlot.includes("slot=09%3A00"), "expected the day's slots");
  assertFalse(badSlot.includes("24:00"));
  assertFalse(badSlot.includes("24%3A00"));
});

// The next day Berlin's clocks jump from 02:00 to 03:00: the last
// Sunday of March, this year's if it is at least two days ahead, else
// next year's. Computed, not fixed, because a slot that is past or
// inside the minimum notice renders without a link.
function nextSpringForwardSunday(): string {
  const today = new Date(Date.now() + 2 * 86_400_000).toISOString()
    .slice(0, 10);
  for (let year = new Date().getUTCFullYear();; year++) {
    const march31 = new Date(Date.UTC(year, 2, 31));
    const sunday = new Date(Date.UTC(year, 2, 31 - march31.getUTCDay()));
    const iso = sunday.toISOString().slice(0, 10);
    if (iso > today) return iso;
  }
}

Deno.test("mig#57: standalone / offers no slot inside the spring-forward gap", async () => {
  const date = nextSpringForwardSunday();
  const html = await renderIndex(`http://localhost/?date=${date}`, {
    hostTz: "Europe/Berlin",
    weeklyAvailability: parseWeeklyAvailability("SUN 01:00-04:00"),
  });

  assert(html.includes("slot=03%3A00"), "expected the 03:00 slot");
  assertFalse(html.includes("slot=02%3A00"), "02:00 does not exist that day");
  assertFalse(html.includes("slot=02%3A30"), "02:30 does not exist that day");
});

// mig#57: Niue ran on UTC-11:19:40 until 1952-10-16. Noon on 1952-10-15
// resolves, the morning slots do not, and @spy4x/time/tz's zonedDateTime
// throws for them, so a check of noon alone let this date through to a
// 500. Every date before 1980 is ignored instead.
Deno.test("mig#57: standalone / ignores a date before 1980", async () => {
  const niue = await renderIndex("http://localhost/?date=1952-10-15", {
    hostTz: "Pacific/Niue",
  });
  const lastBefore = await renderIndex("http://localhost/?date=1979-12-31");
  const first = await renderIndex("http://localhost/?date=1980-01-01");

  assertEquals(gridHeaderZoneLabel(niue), null);
  assertFalse(niue.includes("1952-10-15"));
  assertEquals(gridHeaderZoneLabel(lastBefore), null);
  assertEquals(gridHeaderZoneLabel(first), "Ho Chi Minh, UTC+7");
});

// mig#57: the month grid runs the host zone's math on every day it
// shows. Dublin kept UTC-0:25:21 until 1916, and Santiago went back to
// UTC-4:42:45 in July 1916 after six years on UTC-5, so checking the
// first day of the grid let July 1916 through. Every month before 1980
// is ignored, and the page shows the current month instead of failing.
Deno.test("mig#57: standalone / ignores a month before 1980", async () => {
  const dublin = await renderIndex("http://localhost/?month=1900-01", {
    hostTz: "Europe/Dublin",
  });
  const santiago = await renderIndex("http://localhost/?month=1916-07", {
    hostTz: "America/Santiago",
  });
  const lastBefore = await renderIndex("http://localhost/?month=1979-12");
  const first = await renderIndex("http://localhost/?month=1980-01");

  assertFalse(dublin.includes("January 1900"));
  assertFalse(santiago.includes("July 1916"));
  assertFalse(lastBefore.includes("December 1979"));
  assert(first.includes("January 1980"), "expected January 1980's grid");
});

// ─── mig#50: daylight-saving days and the grid's date heading ────────

// The slot grid's own date heading (TimeSlots.tsx's `<h3>`).
function gridHeading(html: string): string | null {
  const m = html.match(
    /<h3 class="text-sm font-medium text-ink-muted">([^<]*)<\/h3>/,
  );
  return m ? m[1] : null;
}

Deno.test("mig#50: Tokyo host, New York visitor, 1 November 2026 — the heading names the slots' own day", async () => {
  // Tokyo's Sunday 17:00-20:00 is Sunday 03:00-06:00 in New York, but
  // Tokyo's noon is still Saturday 23:00 there — the heading's old
  // anchor.
  const html = await renderIndex(
    "http://localhost/?date=2026-11-01&tz=America/New_York",
    {
      hostTz: "Asia/Tokyo",
      weeklyAvailability: parseWeeklyAvailability("SUN 17:00-20:00"),
      slotDurationMin: 60,
    },
  );
  assertEquals(gridHeading(html), "Sunday, 1 November 2026");
  assertFalse(html.includes("Saturday, 31 October 2026"), "DateCard too");
  assert(html.includes("03:00, New York, UTC-5"), "expected the 17:00 slot");
  // All three slots are on the heading's day, so no slot's accessible
  // name ends in a date note. ("Sun 1 Nov" itself does appear: the
  // mobile summary bar's short form of the heading.)
  assertFalse(/UTC-5, \w{3} \d/.test(html), "no slot needs a date note");
});

Deno.test("mig#50: a day with no slots names the picked calendar day, not the visitor's day at the host's noon", async () => {
  const html = await renderIndex(
    "http://localhost/?date=2026-11-01&tz=America/New_York",
    {
      hostTz: "Asia/Tokyo",
      weeklyAvailability: parseWeeklyAvailability("SUN 17:00-20:00"),
      blockedDates: new Set(["2026-11-01"]),
    },
  );
  assert(
    html.includes("No available times on Sunday, 1 November 2026."),
    "expected the empty-day line to name the picked day",
  );
  assertFalse(html.includes("Saturday, 31 October 2026"));
});

Deno.test("mig#50: with slots on two visitor days, the heading names the first and only the other day's slots carry a note", async () => {
  // Ho Chi Minh 09:00-17:00 is 22:00 Monday to 05:30 Tuesday in New
  // York: the heading is Monday, and from 11:00 host time (00:00
  // Tuesday in New York) each slot names Tuesday.
  const html = await renderIndex(
    `http://localhost/?date=${TEST_DATE}&tz=America/New_York`,
  );
  assertEquals(gridHeading(html), "Monday, 5 October 2026");
  assert(/22:00, New York, UTC-4(?!,)/.test(html), "22:00 Monday: no note");
  assert(/23:30, New York, UTC-4(?!,)/.test(html), "23:30 Monday: no note");
  assert(html.includes("00:00, New York, UTC-4, Tue 6 Oct"));
  assert(html.includes("05:30, New York, UTC-4, Tue 6 Oct"));
});
