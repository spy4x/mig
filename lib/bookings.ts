// JSON-file persistence for bookings with an in-process AsyncMutex.
//
// Concurrency model:
//   - Reads: lock-free, served from in-memory snapshot.
//   - Writes: serialised through mutex; mutate() runs user fn under
//     lock, atomically writes to disk (temp file + rename).
//
// Crash safety: temp-file rename(2) is atomic on POSIX. If we crash
// after writing temp file but before rename, the next process start
// reads the old file intact (temp is overwritten on next write).
// If we crash mid-rename, the kernel still gives us a complete file.

import type { Booking } from "./types.ts";
import { isCalendarDateTime } from "./clock.ts";

// Before mig#57 the booking validator checked only the shape of `date`
// and `slot`, so a hand-made POST could store "2027-02-30" at "10:60",
// and mig's own zonedDateTime rolled that over: the visitor was told
// 2 March at 11:00. @spy4x/time/tz's zonedDateTime throws on it
// instead, which would break /confirmed, /cancel and POST /api/cancel
// for that booking. So a stored record gets the same roll-over once,
// when it is loaded, and keeps meaning what the visitor was told. A
// record whose date or time is not even the right shape, or would roll
// past year 9999, is left alone.
export function rollOverStoredWallClock(booking: Booking): Booking {
  if (isCalendarDateTime(booking.date, booking.time)) return booking;
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(booking.date);
  const t = /^(\d{2}):(\d{2})$/.exec(booking.time);
  if (!d || !t) return booking;
  const rolled = new Date(
    Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], 0, 0),
  );
  if (Number.isNaN(rolled.getTime())) return booking;
  // "9999-12-32" rolls into year 10000, which toISOString writes as
  // "+010000-01-01" and no "YYYY-MM-DD" field can hold.
  if (rolled.getUTCFullYear() > 9999) return booking;
  const iso = rolled.toISOString();
  return { ...booking, date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export class AsyncMutex {
  private locked = false;
  private waiters: Array<() => void> = [];

  acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(() => this.release());
    }
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => resolve(() => this.release()));
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Lock stays held; we hand it to the next waiter.
      next();
    } else {
      this.locked = false;
    }
  }
}

export interface BookingsStoreOptions {
  filePath: string;
}

export class BookingsStore {
  private bookings: Booking[] = [];
  private mutex = new AsyncMutex();
  private loaded = false;
  private filePath: string;

  constructor(opts: BookingsStoreOptions) {
    this.filePath = opts.filePath;
  }

  async init(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      const text = await Deno.readTextFile(this.filePath);
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        throw new Error("bookings.json must be a JSON array");
      }
      this.bookings = (parsed as Booking[]).map(rollOverStoredWallClock);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        this.bookings = [];
        // Ensure parent dir exists + write empty file
        await this.persist();
      } else {
        throw e;
      }
    }
    this.loaded = true;
  }

  // Atomic write: temp file + rename. Creates parent dir if missing.
  private async persist(): Promise<void> {
    const dir = this.filePath.slice(0, this.filePath.lastIndexOf("/"));
    if (dir) {
      try {
        await Deno.mkdir(dir, { recursive: true });
      } catch (e) {
        if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
      }
    }
    const tmp = this.filePath + ".tmp";
    await Deno.writeTextFile(tmp, JSON.stringify(this.bookings, null, 2));
    await Deno.rename(tmp, this.filePath);
  }

  // Lock-free snapshot read.
  list(): Booking[] {
    if (!this.loaded) throw new Error("BookingsStore.init() not called");
    return [...this.bookings];
  }

  get(id: string): Booking | undefined {
    return this.bookings.find((b) => b.id === id);
  }

  // Find bookings for a given host-local date. Returns shallow copies.
  forDate(date: string): Booking[] {
    return this.bookings.filter((b) => b.date === date);
  }

  // Run `fn` under mutex. fn receives a mutable copy of the array;
  // whatever it pushes/mutates is persisted atomically.
  // Returns whatever fn returns.
  async mutate<T>(fn: (current: Booking[]) => Promise<T> | T): Promise<T> {
    if (!this.loaded) {
      await this.init();
    }
    const release = await this.mutex.acquire();
    try {
      // Hand fn a clone so accidental mutations don't bypass persistence.
      const draft = [...this.bookings];
      const result = await fn(draft);
      // Replace internal array
      this.bookings = draft;
      await this.persist();
      return result;
    } finally {
      release();
    }
  }
}
