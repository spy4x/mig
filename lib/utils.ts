// Fresh 2 helpers + app state typing.

import { createDefine } from "fresh";
import type { BookingsStore } from "./bookings.ts";
import type { Config } from "./types.ts";
import type { RateLimiter } from "./ratelimit.ts";

export interface State {
  config: Config;
  bookings: BookingsStore;
  rateLimiter: RateLimiter;
}

export const define = createDefine<State>();
