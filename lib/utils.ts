// Fresh 2 helpers + app state typing.

import { createDefine } from "fresh";
import type { BookingsStore } from "./bookings.ts";
import type { Config } from "./types.ts";
import type { MemoryRateLimiter } from "@spy4x/platform/rate-limit/memory";

export interface State {
  config: Config;
  bookings: BookingsStore;
  rateLimiter: MemoryRateLimiter;
}

export const define = createDefine<State>();
