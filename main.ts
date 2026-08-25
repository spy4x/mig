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

// Self-healthcheck: connects to the listening socket and exits 0 if alive.
// Used by Docker HEALTHCHECK (the distroless image has no shell, no curl).
async function selfHealthcheck(port: number): Promise<void> {
  try {
    const conn = await Deno.connect({ port, hostname: "127.0.0.1" });
    conn.close();
    Deno.exit(0);
  } catch {
    Deno.exit(1);
  }
}

if (Deno.args[0] === "--healthcheck") {
  await selfHealthcheck(config.port);
}

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
