// GET /api/slots?date=YYYY-MM-DD — JSON list of slots for a date.
// Used by the optional JS-enhanced picker.

import { define } from "../../lib/utils.ts";
import { minToHHMM, zonedDateTime } from "@spy4x/time/tz";
import {
  EARLIEST_DATE,
  hostSlotInstant,
  isCalendarDateTime,
} from "../../lib/clock.ts";

export const handler = define.handlers({
  GET(ctx) {
    const cfg = ctx.state.config;
    const url = new URL(ctx.req.url);
    const date = url.searchParams.get("date") ?? "";
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
      });
    }
    if (cfg.blockedDates.has(date)) {
      return Response.json({ date, slots: [] });
    }

    const dayName = (() => {
      const dt = zonedDateTime(date, "12:00", cfg.hostTz);
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: cfg.hostTz,
        weekday: "short",
      }).format(dt).toUpperCase();
    })();
    const ranges =
      cfg.weeklyAvailability[dayName as keyof typeof cfg.weeklyAvailability];
    const booked = new Set(
      ctx.state.bookings.forDate(date)
        .filter((b) => b.status === "active")
        .map((b) => b.time),
    );
    const minStart = new Date(Date.now() + cfg.minNoticeHours * 3600_000);

    const slots = [];
    for (const r of ranges) {
      for (
        let m = r.startMin;
        m <= r.endMin - cfg.slotDurationMin;
        m += cfg.slotDurationMin
      ) {
        const time = minToHHMM(m);
        // null inside a spring-forward gap: no such slot (mig#57).
        const instant = hostSlotInstant(date, time, cfg.hostTz);
        if (!instant) continue;
        slots.push({
          time,
          available: !booked.has(time) && instant >= minStart,
        });
      }
    }
    return Response.json({ date, slots });
  },
});
