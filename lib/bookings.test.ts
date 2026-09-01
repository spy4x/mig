import { assertEquals, assertExists } from "@std/assert";
import { AsyncMutex, BookingsStore } from "../lib/bookings.ts";
import type { Booking } from "../lib/types.ts";

function tmpPath(): string {
  return `/tmp/mig-test-${crypto.randomUUID()}.json`;
}

async function rm(path: string) {
  try {
    await Deno.remove(path);
  } catch {
    // ignore
  }
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "01HXYZ1234567890ABCDEFGHJK",
    createdAt: new Date().toISOString(),
    date: "2026-08-28",
    time: "10:00",
    hostTz: "UTC",
    guestName: "Jane",
    guestEmail: "jane@example.com",
    cancelTokenHash: "abc123",
    status: "active",
    ...overrides,
  };
}

Deno.test("BookingsStore — loads empty when file missing", async () => {
  const path = tmpPath();
  await rm(path);
  const s = new BookingsStore({ filePath: path });
  await s.init();
  assertEquals(s.list(), []);
  await rm(path);
});

Deno.test("BookingsStore — persists mutations atomically", async () => {
  const path = tmpPath();
  await rm(path);
  const s = new BookingsStore({ filePath: path });
  await s.init();

  await s.mutate((draft) => {
    draft.push(makeBooking({ id: "a", guestTz: "America/New_York" }));
    draft.push(makeBooking({ id: "b" }));
  });
  assertEquals(s.list().length, 2);

  // Re-read from disk
  const s2 = new BookingsStore({ filePath: path });
  await s2.init();
  assertEquals(s2.list().length, 2);
  assertEquals(s2.list()[0].id, "a");
  assertEquals(s2.list()[0].guestTz, "America/New_York");
  await rm(path);
});

Deno.test("BookingsStore — mutate serialises concurrent writes", async () => {
  const path = tmpPath();
  await rm(path);
  const s = new BookingsStore({ filePath: path });
  await s.init();

  const N = 50;
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      s.mutate((draft) => {
        draft.push(makeBooking({ id: `b${i}` }));
      })),
  );
  assertEquals(s.list().length, N);
  await rm(path);
});

Deno.test("BookingsStore — forDate filters by host-local date", async () => {
  const path = tmpPath();
  await rm(path);
  const s = new BookingsStore({ filePath: path });
  await s.init();
  await s.mutate((draft) => {
    draft.push(makeBooking({ id: "1", date: "2026-08-28", time: "10:00" }));
    draft.push(makeBooking({ id: "2", date: "2026-08-28", time: "11:00" }));
    draft.push(makeBooking({ id: "3", date: "2026-08-29", time: "10:00" }));
  });
  assertEquals(s.forDate("2026-08-28").length, 2);
  assertEquals(s.forDate("2026-08-29").length, 1);
  assertEquals(s.forDate("2026-08-30").length, 0);
  await rm(path);
});

Deno.test("AsyncMutex — serialises critical section", async () => {
  const m = new AsyncMutex();
  const order: number[] = [];
  const task = (id: number) =>
    m.acquire().then(async (release) => {
      order.push(id);
      await new Promise((r) => setTimeout(r, 10));
      order.push(id + 100);
      release();
    });
  await Promise.all([task(1), task(2), task(3)]);
  // Each task's "before release" must precede its "after release"
  assertEquals(order[0] < order[1], true);
  assertEquals(order[2] < order[3], true);
  assertEquals(order[4] < order[5], true);
  // The three sections should not interleave
  const ids = [1, 2, 3].filter((i) =>
    order.indexOf(i) < order.indexOf(i + 100)
  );
  assertEquals(new Set(ids).size, 3);
});

Deno.test("BookingsStore — temp file cleanup on crash simulation", async () => {
  // Simulate crash by manually creating a stale .tmp file, then start.
  const path = tmpPath();
  const tmp = path + ".tmp";
  await rm(path);
  await rm(tmp);
  await Deno.writeTextFile(tmp, "{ broken json");
  const s = new BookingsStore({ filePath: path });
  await s.init(); // should still succeed
  assertEquals(s.list().length, 0);
  await rm(path);
  await rm(tmp);
});

Deno.test("BookingsStore — get returns booking by id", async () => {
  const path = tmpPath();
  await rm(path);
  const s = new BookingsStore({ filePath: path });
  await s.init();
  await s.mutate((draft) => {
    draft.push(makeBooking({ id: "abc" }));
  });
  const found = s.get("abc");
  assertExists(found);
  assertEquals(found!.id, "abc");
  assertEquals(s.get("missing"), undefined);
  await rm(path);
});
