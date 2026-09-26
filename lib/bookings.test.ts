import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { BookingsStore, rollOverStoredWallClock } from "../lib/bookings.ts";
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

// mig#57: before the validator checked the calendar, "2027-02-30" at
// "10:60" could be stored; it is rolled over on load to what the
// visitor was told, and a valid record is left exactly as it was.
Deno.test("BookingsStore — rolls a stored impossible date and time over on load", async () => {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  const base = {
    createdAt: "2026-09-01T10:00:00.000Z",
    hostTz: "Europe/Berlin",
    guestName: "Visitor",
    guestEmail: "visitor@example.com",
    cancelTokenHash: "h",
    status: "active" as const,
  };
  await Deno.writeTextFile(
    path,
    JSON.stringify([
      { ...base, id: "rolled", date: "2027-02-30", time: "10:60" },
      { ...base, id: "valid", date: "2027-03-01", time: "09:30" },
    ]),
  );
  try {
    const store = new BookingsStore({ filePath: path });
    await store.init();
    assertEquals(
      [store.get("rolled")?.date, store.get("rolled")?.time],
      ["2027-03-02", "11:00"],
    );
    assertEquals(
      [store.get("valid")?.date, store.get("valid")?.time],
      ["2027-03-01", "09:30"],
    );
  } finally {
    await Deno.remove(path);
  }
});

// mig#57: rolling "9999-12-32" over lands in year 10000, which
// toISOString writes as "+010000-01-01T10:00", so slicing it gave the
// date "+010000-01" and the time "01T10". Such a record stays as stored.
Deno.test("rollOverStoredWallClock — leaves a record that would roll past year 9999 unchanged", () => {
  const pastYear = makeBooking({ date: "9999-12-32", time: "10:00" });
  const pastMidnight = makeBooking({ date: "9999-12-31", time: "24:00" });

  assertEquals(rollOverStoredWallClock(pastYear), pastYear);
  assertEquals(rollOverStoredWallClock(pastMidnight), pastMidnight);
});

Deno.test("BookingsStore — a failed write leaves no temp file behind", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/bookings.json`;
    const s = new BookingsStore({ filePath: path });
    await s.init();
    // Put a non-empty directory where the file was, so the rename that
    // finishes the next write fails after the temp file was written.
    await Deno.remove(path);
    await Deno.mkdir(`${path}/blocker`, { recursive: true });
    await assertRejects(() =>
      s.mutate((draft) => {
        draft.push(makeBooking());
      })
    );
    const left: string[] = [];
    for await (const entry of Deno.readDir(dir)) left.push(entry.name);
    assertEquals(left, ["bookings.json"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("BookingsStore — a bookings file that is not JSON stops startup", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/bookings.json`;
    await Deno.writeTextFile(path, "{ broken json");
    const s = new BookingsStore({ filePath: path });
    await assertRejects(() => s.init(), Error, "is not valid JSON");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
