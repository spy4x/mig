// mig — app setup. Exports `app` for Fresh dev/build to consume.

import { App, staticFiles } from "fresh";
import { config } from "./lib/config.ts";
import { BookingsStore } from "./lib/bookings.ts";
import { RateLimiter } from "./lib/ratelimit.ts";
import type { State } from "./lib/utils.ts";

const store = new BookingsStore({ filePath: config.dataPath });
await store.init();

const rateLimiter = new RateLimiter({
  windowMs: 5 * 60 * 1000,
  max: config.rateLimitPer5Min,
});

export const app = new App<State>();

app.use(staticFiles());

// Wire shared state into every request
app.use((ctx) => {
  ctx.state.config = config;
  ctx.state.bookings = store;
  ctx.state.rateLimiter = rateLimiter;
  return ctx.next();
});

// File-system routes (routes/*.tsx, routes/api/*.ts)
app.fsRoutes();
