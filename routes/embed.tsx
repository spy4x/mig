import { define } from "../lib/utils.ts";
import { BookingPicker } from "../components/BookingPicker.tsx";
import { countSlotsForDate, getCandidateDates } from "../lib/availability.ts";
import { minToHHMM, zonedDateTime } from "../lib/tz.ts";

interface EmbedData {
  date: string | null;
  slot: string | null;
  dates: Array<{ date: string; label: string; slots: number; full: boolean }>;
  slots: Array<{ time: string; available: boolean }>;
}

function parseDateParam(v: string | null): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function parseSlotParam(v: string | null): string | null {
  if (!v || !/^\d{2}:\d{2}$/.test(v)) return null;
  return v;
}

function minStartInstant(hours: number): Date {
  return new Date(Date.now() + hours * 3600_000);
}

function dayNameFromDate(
  date: string,
  tz: string,
): "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN" {
  const dt = zonedDateTime(date, "12:00", tz);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
  }).format(dt).toUpperCase() as
    | "MON"
    | "TUE"
    | "WED"
    | "THU"
    | "FRI"
    | "SAT"
    | "SUN";
}

export const handler = define.handlers({
  GET(ctx) {
    const cfg = ctx.state.config;
    const url = new URL(ctx.req.url);
    const date = parseDateParam(url.searchParams.get("date"));
    const slot = parseSlotParam(url.searchParams.get("slot"));

    const minStart = minStartInstant(cfg.minNoticeHours);
    const today = new Date().toISOString().slice(0, 10);
    const candidates = getCandidateDates(today, cfg.bookingHorizonDays, "UTC");

    const dates = candidates.map((d) => {
      const blocked = cfg.blockedDates.has(d);
      const bookedCount = blocked ? 999 : ctx.state.bookings.forDate(d)
        .filter((b) => b.status === "active").length;
      const slots = blocked ? 0 : countSlotsForDate(
        d,
        cfg.weeklyAvailability,
        cfg.slotDurationMin,
        bookedCount,
        cfg.hostTz,
        minStart,
      );
      const dt = new Date(d + "T12:00:00Z");
      const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
        dt.getUTCDay()
      ];
      const dayNum = dt.getUTCDate();
      const monthShort = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ][dt.getUTCMonth()];
      return {
        date: d,
        label: `${dayName} ${dayNum} ${monthShort}`,
        slots,
        full: slots === 0,
      };
    }).filter((d) => d.slots > 0 || d.date === date);

    const slots: EmbedData["slots"] = [];
    if (date && !cfg.blockedDates.has(date)) {
      const dayBookings = ctx.state.bookings.forDate(date);
      const dayName = dayNameFromDate(date, cfg.hostTz);
      const ranges = cfg.weeklyAvailability[dayName];
      const booked = new Set(
        dayBookings.filter((b) => b.status === "active").map((b) => b.time),
      );
      for (const r of ranges) {
        for (
          let m = r.startMin;
          m <= r.endMin - cfg.slotDurationMin;
          m += cfg.slotDurationMin
        ) {
          const time = minToHHMM(m);
          const instant = zonedDateTime(date, time, cfg.hostTz);
          slots.push({
            time,
            available: !booked.has(time) && instant >= minStart,
          });
        }
      }
    }

    return { data: { date, slot, dates, slots } };
  },
});

export default define.page<typeof handler>(function Embed({ data, state }) {
  const { date, slot, dates, slots } = data;
  const cfg = state.config;
  return (
    <main class="min-h-screen p-3 sm:p-4">
      <h1 class="text-lg font-semibold text-slate-100 mb-3">
        Book {cfg.hostName}
      </h1>
      <BookingPicker
        dates={dates}
        slots={slots}
        selectedDate={date}
        selectedSlot={slot}
        durationMin={cfg.slotDurationMin}
        hostTz={cfg.hostTz}
        publicUrl={cfg.publicUrl}
      />
    </main>
  );
});
