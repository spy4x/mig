// GET /api/slots?date=YYYY-MM-DD — JSON list of slots for a date.
// Used by the optional JS-enhanced picker.

import { define } from "../../lib/utils.ts"
import { offeredSlots } from "../../lib/availability.ts"
import { EARLIEST_DATE, isCalendarDateTime } from "../../lib/clock.ts"

export const handler = define.handlers({
  GET(ctx) {
    const cfg = ctx.state.config
    const url = new URL(ctx.req.url)
    const date = url.searchParams.get("date") ?? ""
    // Before 1980 some zones' offsets had seconds (see EARLIEST_DATE),
    // and "2026-02-30" is not a date at all (mig#57).
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      date < EARLIEST_DATE ||
      !isCalendarDateTime(date, "12:00", cfg.hostTz)
    ) {
      return new Response(JSON.stringify({ error: "bad date" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    }
    // A blocked date or one past the booking horizon offers nothing
    // (mig#113).
    const slots = offeredSlots(
      cfg,
      date,
      ctx.state.bookings.forDate(date),
      new Date(),
    ).map(({ time, available }) => ({ time, available }))
    return Response.json({ date, slots })
  },
})
