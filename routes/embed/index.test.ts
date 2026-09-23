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
import { RateLimiter } from "../../lib/ratelimit.ts";
import { parseWeeklyAvailability } from "../../lib/availability.ts";
import { zonedDateTime } from "../../lib/tz.ts";
import { handler } from "./index.tsx";
import type { EmbedData } from "./index.tsx";

type SlotCell = EmbedData["slots"][number];

// Host in Ho Chi Minh (no DST — always UTC+7). October keeps New York
// unambiguously in EDT (UTC-4) — see lib/tz.test.ts for the same
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
): Promise<EmbedData> {
  const cfg = fakeConfig();
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
        rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
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

Deno.test("mig#15 round 2: after a conflict, the slot list shows the taken slot disabled", async () => {
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
        rateLimiter: new RateLimiter({ windowMs: 300_000, max: 10 }),
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
  assertEquals(first!.displayTime, "22:00, New York, UTC-4");
  assert(
    data.selectedDateLabel?.includes("October 2026"),
    `expected an October 2026 date label, got "${data.selectedDateLabel}"`,
  );
});

Deno.test("mig#15 round 2: slotDateLabel comes from the slot's own instant, not noon of the host day", async () => {
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
  assertEquals(first!.displayTime, "09:00, Ho Chi Minh, UTC+7");
});

Deno.test("mig#15: /embed with an invalid tz falls back to the host's zone", async () => {
  const data = await getEmbedData(
    `http://localhost/embed?date=${TEST_DATE}&tz=Not%2FA_Timezone`,
  );

  assertEquals(data.tz, null);
  const first = data.slots.find((s: SlotCell) => s.time === "09:00");
  assertEquals(first!.displayTime, "09:00, Ho Chi Minh, UTC+7");
});

Deno.test("mig#15 round 2: /embed keeps modern zone names exactly as sent (never a legacy rename)", async () => {
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
    const first = data.slots.find((s: SlotCell) => s.time === "09:00");
    assert(
      first?.displayTime?.includes(city),
      `expected the 09:00 slot's displayTime to include "${city}", got "${first?.displayTime}"`,
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
  assertEquals(first!.displayTime, "11:00, Tokyo, UTC+9");
});
