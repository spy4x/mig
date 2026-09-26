// JSON-file persistence for bookings with an in-process AsyncMutex.
//
// Concurrency model:
//   - Reads: lock-free, served from in-memory snapshot.
//   - Writes: serialised through mutex; mutate() runs user fn under
//     lock, atomically writes to disk (temp file + rename).
//
// Crash safety: `atomicWriteJson` (@spy4x/platform) writes a temp file
// named `<path>.<pid>.<sequence>.tmp` and renames it over the real one;
// rename(2) is atomic on POSIX, so a reader sees the old file or the new
// one, never half of either. A write that fails removes its temp file.

import { AsyncMutex } from "@spy4x/platform/universal/concurrency";
import {
  atomicWriteJson,
  readJsonFile,
} from "@spy4x/platform/server/atomic-json";
import { denoFileSystem } from "@spy4x/platform/server/deno-fs";
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

export interface BookingsStoreOptions {
  filePath: string;
}

export class BookingsStore {
  private bookings: Booking[] = [];
  private mutex = new AsyncMutex();
  private loaded = false;
  private filePath: string;
  private writeSequence = 0;

  constructor(opts: BookingsStoreOptions) {
    this.filePath = opts.filePath;
  }

  async init(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    const read = await readJsonFile<unknown>(denoFileSystem, this.filePath);
    if (read.kind === "missing") {
      this.bookings = [];
      // Creates the parent directory and an empty file.
      await this.persist();
    } else if (read.kind === "invalid") {
      throw new Error(`${this.filePath} is not valid JSON: ${read.reason}`);
    } else if (!Array.isArray(read.value)) {
      throw new Error("bookings.json must be a JSON array");
    } else {
      this.bookings = (read.value as Booking[]).map(rollOverStoredWallClock);
    }
    this.loaded = true;
  }

  // Atomic write: temp file + rename, parent directory created if
  // missing. The temp name carries the pid and a per-store counter, so
  // two writes can never share one.
  private async persist(): Promise<void> {
    await atomicWriteJson(denoFileSystem, this.filePath, this.bookings, {
      pid: Deno.pid,
      sequence: this.writeSequence++,
    });
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
