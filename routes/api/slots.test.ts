// GET /api/slots — the date check and the slot list, for mig#57.

import { assertEquals } from "@std/assert";
import type { Context } from "fresh";
import type { State } from "../../lib/utils.ts";
import type { Config } from "../../lib/types.ts";
import { BookingsStore } from "../../lib/bookings.ts";
import { MemoryRateLimiter } from "@spy4x/platform/rate-limit/memory";
import { parseWeeklyAvailability } from "../../lib/availability.ts";
import { handler } from "./slots.ts";

function fakeConfig(): Config {
  return {
    hostName: "Jane Doe",
    hostEmail: "jane@example.com",
    hostTz: "Europe/Berlin",
    meetingUrl: "https://meet.example.com/room",
    publicUrl: "https://mig.example.com",
    weeklyAvailability: parseWeeklyAvailability("SUN 01:00-04:00"),
    slotDurationMin: 30,
    minNoticeHours: 0,
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
    dataPath: "/tmp/mig-slots-test-unused.json",
    hideBranding: false,
    githubUrl: "https://github.com/spy4x/mig",
    version: "test",
  };
}

async function getSlots(
  date: string,
  hostTz = "Europe/Berlin",
): Promise<Response> {
  const path = `/tmp/mig-slots-test-${crypto.randomUUID()}.json`;
  const bookings = new BookingsStore({ filePath: path });
  await bookings.init();
  try {
    const ctx = {
      req: new Request(`http://localhost/api/slots?date=${date}`),
      state: {
        config: { ...fakeConfig(), hostTz },
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
      },
    } as unknown as Context<State>;
    return await handler.GET!(ctx) as Response;
  } finally {
    try {
      await Deno.remove(path);
    } catch {
      // ignore
    }
  }
}

// @spy4x/time/tz's zonedDateTime throws on "2026-02-30" where mig's own
// copy rolled it over into 2 March, so the route refuses it up front.
Deno.test("mig#57: /api/slots answers 400 for a date that is not on the calendar", async () => {
  const res = await getSlots("2026-02-30");

  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "bad date" });
});

// Berlin's clocks jump from 02:00 to 03:00 on 2027-03-28, a Sunday.
Deno.test("mig#57: /api/slots lists no slot inside the spring-forward gap", async () => {
  const res = await getSlots("2027-03-28");
  const body = await res.json() as { slots: { time: string }[] };

  assertEquals(body.slots.map((s) => s.time), [
    "01:00",
    "01:30",
    "03:00",
    "03:30",
  ]);
});

// mig#57: New York ran on local mean time (UTC-4:56:02) before 1900, and
// @spy4x/time/tz's zonedDateTime throws for an offset with seconds.
Deno.test("mig#57: /api/slots answers 400 for a date the host zone cannot resolve to the minute", async () => {
  const res = await getSlots("1800-06-01", "America/New_York");

  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "bad date" });
});
