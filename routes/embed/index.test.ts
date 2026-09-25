// mig#15 — /embed must know the visitor's timezone before the slot
// list renders, not just at submit. These tests call the route's GET
// handler directly (same pattern as routes/embed/book.test.ts) with a
// real Request carrying a `tz` query param, and check the data it
// hands to the page: per-slot clock strings, the date label, and the
// tz-redirect flag.

import { assert, assertEquals } from "@std/assert";
import type { Context } from "fresh";
import type { State } from "../../lib/utils.ts";
import type { Config } from "../../lib/types.ts";
import { BookingsStore } from "../../lib/bookings.ts";
import { MemoryRateLimiter } from "@spy4x/platform/rate-limit/memory";
import { parseWeeklyAvailability } from "../../lib/availability.ts";
import { zonedDateTime } from "@spy4x/time/tz";
import { handler } from "./index.tsx";
import type { EmbedData } from "./index.tsx";

type SlotCell = EmbedData["slots"][number];

// Host in Ho Chi Minh (no DST — always UTC+7). October keeps New York
// unambiguously in EDT (UTC-4) — see lib/clock.test.ts for the same
// choice. 2026-10-06 is a Tuesday within MON-FRI 09:00-17:00.
const HOST_TZ = "Asia/Ho_Chi_Minh";
const TEST_DATE = "2026-10-06";

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
    dataPath: "/tmp/mig-embed-index-test-unused.json",
    hideBranding: false,
    githubUrl: "https://github.com/spy4x/mig",
    version: "test",
  };
}

async function rm(path: string) {
  try {
    await Deno.remove(path);
  } catch {
    // ignore
  }
}

async function getEmbedData(
  url: string,
  cfgOverrides: Partial<Config> = {},
): Promise<EmbedData> {
  const cfg = { ...fakeConfig(), ...cfgOverrides };
  const path = `/tmp/mig-embed-index-test-${crypto.randomUUID()}.json`;
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  try {
    const req = new Request(url);
    const ctx = {
      req,
      state: {
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
      },
    } as unknown as Context<State>;
    const res = await handler.GET!(ctx);
    // define.handlers' GET returns { data } (a Fresh RouteConfig
    // response), not a Response — cast through unknown, same as the
    // response shape routes/embed/embed.test.tsx's fakePageProps relies
    // on for `data`.
    return (res as unknown as { data: EmbedData }).data;
  } finally {
    await rm(path);
  }
}

Deno.test("after a conflict, the slot list shows the taken slot disabled", async () => {
  // Companion to lib/book.test.ts's conflict-drops-slot test: once the
  // booking exists, the picker route itself (not the write path) must
  // show that slot disabled so the visitor can't pick it again.
  const cfg = fakeConfig();
  const path = `/tmp/mig-embed-index-test-${crypto.randomUUID()}.json`;
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  try {
    await bookings.mutate((draft) => {
      draft.push({
        id: "01EXISTING",
        createdAt: new Date().toISOString(),
        date: TEST_DATE,
        time: "09:00",
        hostTz: HOST_TZ,
        guestName: "Someone Else",
        guestEmail: "else@example.com",
        cancelTokenHash: "h",
        status: "active",
      });
    });
    const req = new Request(`http://localhost/embed?date=${TEST_DATE}`);
    const ctx = {
      req,
      state: {
        config: cfg,
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
      },
    } as unknown as Context<State>;
    const res = await handler.GET!(ctx);
    const data = (res as unknown as { data: EmbedData }).data;
    const taken = data.slots.find((s: SlotCell) => s.time === "09:00");
    const free = data.slots.find((s: SlotCell) => s.time === "09:30");
    assertEquals(taken?.available, false);
    assertEquals(free?.available, true);
  } finally {
    await rm(path);
  }
});

Deno.test("mig#15: /embed with a valid tz renders the slot list in the visitor's zone", async () => {
  const data = await getEmbedData(
    `http://localhost/embed?date=${TEST_DATE}&tz=America%2FNew_York`,
  );

  assertEquals(data.tz, "America/New_York");
  assert(data.slots.length > 0, "expected slots for a MON-FRI date");
  // 09:00 host-local (Ho Chi Minh) is 22:00 the previous day in New York.
  const first = data.slots.find((s: SlotCell) => s.time === "09:00");
  assert(first, "expected the 09:00 host-local slot");
  // mig#48: the slot itself only carries the bare time now — the zone
  // ("New York, UTC-4") renders once, in the grid's header.
  assertEquals(first!.displayHHMM, "22:00");
  assertEquals(first!.ariaZoneLabel, "New York, UTC-4");
  assertEquals(data.zoneLabel, "New York, UTC-4");
  assert(
    data.selectedDateLabel?.includes("October 2026"),
    `expected an October 2026 date label, got "${data.selectedDateLabel}"`,
  );
});

Deno.test("slotDateLabel comes from the slot's own instant, not noon of the host day", async () => {
  // The 09:00 Ho Chi Minh slot on 2026-10-06 (Tuesday) is 22:00 the
  // *previous* evening in New York — Monday 5 October. Noon of the
  // same host day converts to 01:00 New York, still Tuesday 6 October
  // — so building this from noon (the bug the reviewer's Chromium
  // repro found: "Thursday" above a confirm button reading "Wed 23
  // Sept") would make this assert "Tuesday, 6 October 2026" instead.
  const data = await getEmbedData(
    `http://localhost/embed?date=${TEST_DATE}&slot=09:00&tz=America%2FNew_York`,
  );
  assertEquals(data.slotDateLabel, "Monday, 5 October 2026");
});

Deno.test("mig#15: picked-day label converts into the visitor's zone, not the host's", async () => {
  // Ho Chi Minh (UTC+7) / Los Angeles (PDT, UTC-7 in October) is a
  // 14-hour gap — wide enough that noon on the host's picked day
  // (Tuesday 6 October) is still the previous evening (Monday 5
  // October) in the visitor's zone. Regression guard for
  // routes/embed/index.tsx's selectedDateLabel: reverting it to format
  // in cfg.hostTz instead of displayTz would silently pass a same-zone
  // or small-offset test but fail this one.
  const data = await getEmbedData(
    `http://localhost/embed?date=${TEST_DATE}&tz=America%2FLos_Angeles`,
  );
  assertEquals(data.selectedDateLabel, "Monday, 5 October 2026");
});

Deno.test("mig#15: /embed's slot list is sorted by instant and labels a slot whose visitor date differs from the picked day", async () => {
  const data = await getEmbedData(
    `http://localhost/embed?date=${TEST_DATE}&tz=America%2FNew_York`,
  );
  // Every slot from 09:00 host-local onward is 22:00+ the previous
  // evening in New York until the host's midday; those slots must
  // still come FIRST (true chronological order), not after the ones
  // that stay on the picked day.
  const instants = data.slots.map((s) =>
    zonedDateTime(TEST_DATE, s.time, HOST_TZ).getTime()
  );
  const sorted = [...instants].sort((a, b) => a - b);
  assertEquals(instants, sorted, "slots must already be instant-sorted");
  const wrapped = data.slots.find((s) => s.time === "09:00");
  assertEquals(wrapped?.dateNote, "Mon 5 Oct");
  // 16:30 host-local (the last slot; availability ends 17:00) is
  // 05:30 the *same* New York calendar day — no note expected.
  const sameDay = data.slots.find((s) => s.time === "16:30");
  assertEquals(sameDay?.dateNote, undefined);
});

Deno.test("mig#15: /embed with no tz param falls back to the host's zone", async () => {
  const data = await getEmbedData(`http://localhost/embed?date=${TEST_DATE}`);

  assertEquals(data.tz, null);
  const first = data.slots.find((s: SlotCell) => s.time === "09:00");
  assert(first, "expected the 09:00 host-local slot");
  assertEquals(first!.displayHHMM, "09:00");
  assertEquals(first!.ariaZoneLabel, "Ho Chi Minh, UTC+7");
  assertEquals(data.zoneLabel, "Ho Chi Minh, UTC+7");
});

Deno.test("mig#15: /embed with an invalid tz falls back to the host's zone", async () => {
  const data = await getEmbedData(
    `http://localhost/embed?date=${TEST_DATE}&tz=Not%2FA_Timezone`,
  );

  assertEquals(data.tz, null);
  const first = data.slots.find((s: SlotCell) => s.time === "09:00");
  assertEquals(first!.displayHHMM, "09:00");
  assertEquals(first!.ariaZoneLabel, "Ho Chi Minh, UTC+7");
  assertEquals(data.zoneLabel, "Ho Chi Minh, UTC+7");
});

Deno.test("/embed keeps modern zone names exactly as sent (never a legacy rename)", async () => {
  // Deno's ICU (and any other browser/runtime) rewrites these four
  // modern names to legacy backward-compat links via
  // resolvedOptions() — round 1's canonicalTimeZone did exactly that,
  // so a Ukrainian visitor saw "Kiev" everywhere. None of these may be
  // renamed.
  const cases: Array<[string, string]> = [
    ["Asia/Kolkata", "Kolkata"],
    ["Europe/Kyiv", "Kyiv"],
    ["Asia/Ho_Chi_Minh", "Ho Chi Minh"],
  ];
  for (const [tz, city] of cases) {
    const data = await getEmbedData(
      `http://localhost/embed?date=${TEST_DATE}&tz=${encodeURIComponent(tz)}`,
    );
    assertEquals(data.tz, tz, `expected tz to stay "${tz}"`);
    assert(
      data.zoneLabel?.includes(city),
      `expected the grid header's zoneLabel to include "${city}", got "${data.zoneLabel}"`,
    );
  }
});

Deno.test("mig#15: /embed canonicalizes a legacy zone alias in the tz param", async () => {
  // "Japan" has no "/" so, pre-canonicalization, it looked like a
  // bare zone and lost its offset entirely ("11:00, Japan"). Canonical
  // form is "Asia/Tokyo".
  const data = await getEmbedData(
    `http://localhost/embed?date=${TEST_DATE}&tz=Japan`,
  );
  assertEquals(data.tz, "Asia/Tokyo");
  const first = data.slots.find((s: SlotCell) => s.time === "09:00");
  assertEquals(first!.displayHHMM, "11:00");
  assertEquals(first!.ariaZoneLabel, "Tokyo, UTC+9");
  assertEquals(data.zoneLabel, "Tokyo, UTC+9");
});

// ─── mig#48 review: header comes from the FIRST slot, not host noon ──
// A Tokyo host (UTC+9, no DST) and a New York visitor (America/New_York)
// straddle both 2026 US daylight-saving transitions once host hours are
// converted to the visitor's zone: 8 March 2026 (spring forward, 2am ->
// 3am EST -> EDT, at 07:00 UTC) and 1 November 2026 (fall back, 2am ->
// 1am EDT -> EST, at 06:00 UTC). Before this fix, the header was taken
// from noon of the host day — which can label the header with an
// offset no visible slot actually has (noon host time had already
// crossed the transition while the visible slots, earlier in the host
// day, hadn't).

const TOKYO_HOST_TZ = "Asia/Tokyo";
const NY_VISITOR_TZ = "America/New_York";

Deno.test("mig#48 review: 8 Mar 2026 (the transition day itself), slots entirely after the spring-forward change — header is the new offset, no slot carries its own", async () => {
  // This runs ON the transition day itself (2026-03-08, a Sunday) —
  // not a day after it — so a header still anchored on noon of the
  // host day would get this wrong: noon host-local (2026-03-08 12:00)
  // converts to 22:00 the previous evening in New York, still EST
  // (UTC-5), even though every slot actually shown (17:00-20:00
  // host-local, all landing at 04:00+ New York) is already EDT
  // (UTC-4). The header must come from the first slot actually shown,
  // not noon.
  const data = await getEmbedData(
    `http://localhost/embed?date=2026-03-08&tz=${
      encodeURIComponent(NY_VISITOR_TZ)
    }`,
    {
      hostTz: TOKYO_HOST_TZ,
      weeklyAvailability: parseWeeklyAvailability("SUN 17:00-20:00"),
      bookingHorizonDays: 3650,
    },
  );
  assertEquals(data.zoneLabel, "New York, UTC-4");
  assert(data.slots.length > 0, "expected slots for the SUN date");
  for (const s of data.slots) {
    assertEquals(
      s.offsetNote,
      undefined,
      `expected no slot to carry its own offset, got one on host time ${s.time}`,
    );
  }
});

Deno.test("mig#48 review: 8 Mar 2026, slots straddling the spring-forward change — only the later slots carry their own offset", async () => {
  // 2026-03-08 (Sunday) 06:00-18:00 host-local straddles the
  // transition once converted to New York: 06:00-15:00 host is still
  // 10:00-01:00 EST (UTC-5); 16:00 host onward is 03:00+ EDT (UTC-4).
  const data = await getEmbedData(
    `http://localhost/embed?date=2026-03-08&tz=${
      encodeURIComponent(NY_VISITOR_TZ)
    }`,
    {
      hostTz: TOKYO_HOST_TZ,
      weeklyAvailability: parseWeeklyAvailability("SUN 06:00-18:00"),
      bookingHorizonDays: 3650,
    },
  );
  // Header comes from the FIRST slot (06:00 host, UTC-5) — still
  // standard time, pre-transition.
  assertEquals(data.zoneLabel, "New York, UTC-5");
  const before = data.slots.find((s) => s.time === "15:00");
  const after = data.slots.find((s) => s.time === "16:00");
  assert(before && after, "expected slots either side of the transition");
  assertEquals(
    before!.offsetNote,
    undefined,
    "expected the pre-transition slot to agree with the header",
  );
  assertEquals(
    after!.offsetNote,
    "UTC-4",
    "expected the post-transition slot to carry its own offset",
  );
});

Deno.test("mig#48 review: 1 Nov 2026 (the transition day itself), slots entirely after the fall-back change — header is the new offset, no slot carries its own", async () => {
  // This runs ON the transition day itself (2026-11-01, a Sunday) —
  // not a day after it — so a header still anchored on noon of the
  // host day would get this wrong: noon host-local (2026-11-01 12:00)
  // converts to 23:00 the previous evening in New York, still EDT
  // (UTC-4), even though every slot actually shown (17:00-20:00
  // host-local, all landing at 03:00+ New York) is already EST
  // (UTC-5). The header must come from the first slot actually shown,
  // not noon.
  const data = await getEmbedData(
    `http://localhost/embed?date=2026-11-01&tz=${
      encodeURIComponent(NY_VISITOR_TZ)
    }`,
    {
      hostTz: TOKYO_HOST_TZ,
      weeklyAvailability: parseWeeklyAvailability("SUN 17:00-20:00"),
      bookingHorizonDays: 3650,
    },
  );
  assertEquals(data.zoneLabel, "New York, UTC-5");
  assert(data.slots.length > 0, "expected slots for the SUN date");
  for (const s of data.slots) {
    assertEquals(
      s.offsetNote,
      undefined,
      `expected no slot to carry its own offset, got one on host time ${s.time}`,
    );
  }
});

Deno.test("mig#48 review: 1 Nov 2026, slots straddling the fall-back change — only the later slots carry their own offset", async () => {
  // 2026-11-01 (Sunday) 06:00-20:00 host-local straddles the
  // transition once converted to New York: 06:00-14:00 host is still
  // 17:00-01:00 EDT (UTC-4); 15:00 host onward is 01:00+ EST (UTC-5).
  const data = await getEmbedData(
    `http://localhost/embed?date=2026-11-01&tz=${
      encodeURIComponent(NY_VISITOR_TZ)
    }`,
    {
      hostTz: TOKYO_HOST_TZ,
      weeklyAvailability: parseWeeklyAvailability("SUN 06:00-20:00"),
      bookingHorizonDays: 3650,
    },
  );
  // Header comes from the FIRST slot (06:00 host, UTC-4) — still
  // daylight time, pre-transition.
  assertEquals(data.zoneLabel, "New York, UTC-4");
  const before = data.slots.find((s) => s.time === "14:00");
  const after = data.slots.find((s) => s.time === "15:00");
  assert(before && after, "expected slots either side of the transition");
  assertEquals(
    before!.offsetNote,
    undefined,
    "expected the pre-transition slot to agree with the header",
  );
  assertEquals(
    after!.offsetNote,
    "UTC-5",
    "expected the post-transition slot to carry its own offset",
  );
});

// ─── mig#57: dates and times that do not exist ───────────────────────

// @spy4x/time/tz's zonedDateTime throws on "2026-02-31" and "24:00"
// where mig's own copy rolled them over, so /embed drops both params
// (as it does any malformed one) instead of failing the request.
Deno.test("mig#57: /embed ignores a date or slot param that is not on the calendar", async () => {
  const data = await getEmbedData(
    "http://localhost/embed?date=2026-02-31&slot=24:00",
  );

  assertEquals(data.date, null);
  assertEquals(data.slot, null);
});

// Berlin's clocks jump from 02:00 to 03:00 on 2027-03-28, a Sunday.
Deno.test("mig#57: /embed offers no slot inside the spring-forward gap", async () => {
  const data = await getEmbedData("http://localhost/embed?date=2027-03-28", {
    hostTz: "Europe/Berlin",
    weeklyAvailability: parseWeeklyAvailability("SUN 01:00-04:00"),
  });

  assertEquals(data.slots.map((s) => s.time), [
    "01:00",
    "01:30",
    "03:00",
    "03:30",
  ]);
});
