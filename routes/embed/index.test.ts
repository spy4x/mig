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

Deno.test("mig#15: /embed with a valid tz renders the slot list in the visitor's zone", async () => {
  const data = await getEmbedData(
    `http://localhost/embed?date=${TEST_DATE}&tz=America%2FNew_York`,
  );

  assertEquals(data.tz, "America/New_York");
  assertEquals(data.showTzRedirect, false);
  assert(data.slots.length > 0, "expected slots for a MON-FRI date");
  // 09:00 host-local (Ho Chi Minh) is 22:00 the previous day in New York.
  const first = data.slots.find((s: SlotCell) => s.time === "09:00");
  assert(first, "expected the 09:00 host-local slot");
  assertEquals(first!.displayTime, "22:00, New York, UTC-4");
  // The picked day's own label is converted too — it's the previous
  // calendar day in New York for this slot's neighbourhood, though the
  // label itself is computed at noon (see routes/embed/index.tsx); the
  // important thing here is it reads in New York, not Ho Chi Minh.
  assert(
    data.selectedDateLabel?.includes("October 2026"),
    `expected an October 2026 date label, got "${data.selectedDateLabel}"`,
  );
});

Deno.test("mig#15: /embed with no tz param falls back to the host's zone and asks the client to redirect", async () => {
  const data = await getEmbedData(`http://localhost/embed?date=${TEST_DATE}`);

  assertEquals(data.tz, null);
  assertEquals(data.showTzRedirect, true);
  const first = data.slots.find((s: SlotCell) => s.time === "09:00");
  assert(first, "expected the 09:00 host-local slot");
  assertEquals(first!.displayTime, "09:00, Ho Chi Minh, UTC+7");
});

Deno.test("mig#15: /embed with an invalid tz falls back to the host's zone without redirecting again", async () => {
  const data = await getEmbedData(
    `http://localhost/embed?date=${TEST_DATE}&tz=Not%2FA_Timezone`,
  );

  assertEquals(data.tz, null);
  // Present-but-invalid must not trigger another redirect — that
  // would loop forever on a bad value.
  assertEquals(data.showTzRedirect, false);
  const first = data.slots.find((s: SlotCell) => s.time === "09:00");
  assertEquals(first!.displayTime, "09:00, Ho Chi Minh, UTC+7");
});
