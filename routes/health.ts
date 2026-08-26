import { define } from "../lib/utils.ts";

// Health endpoint for Gatus / Docker. Returns 200 if app is alive and
// the bookings JSON is readable.

export const handler = define.handlers({
  GET(ctx) {
    try {
      // Touch the bookings store — exercises the mutex + file.
      ctx.state.bookings.list();
      return new Response("ok\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    } catch (e) {
      return new Response(`unhealthy: ${(e as Error).message}\n`, {
        status: 503,
        headers: { "content-type": "text/plain" },
      });
    }
  },
});
