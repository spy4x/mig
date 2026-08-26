import { define } from "../lib/utils.ts";
import { BookingPicker } from "../components/BookingPicker.tsx";
import { countSlotsForDate, getCandidateDates } from "../lib/availability.ts";
import { minToHHMM, zonedDateTime } from "../lib/tz.ts";

interface DateCell {
  date: string;
  dayShort: string;
  dayNum: number;
  monthShort: string;
  monthName: string;
  year: number;
  monthIdx: number;
  slots: number;
  full: boolean;
}

interface EmbedData {
  date: string | null;
  slot: string | null;
  dates: DateCell[];
  selectedDateLabel: string | null;
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

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = [
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
];
const MONTH_NAME = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_NAME = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

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
      const dayShort = DAY_SHORT[dt.getUTCDay()];
      const dayNum = dt.getUTCDate();
      const monthIdx = dt.getUTCMonth();
      return {
        date: d,
        dayShort,
        dayNum,
        monthShort: MONTH_SHORT[monthIdx],
        monthName: MONTH_NAME[monthIdx],
        year: dt.getUTCFullYear(),
        monthIdx,
        slots,
        full: slots === 0,
      };
    }).filter((d) => d.slots > 0 || d.date === date);

    let selectedDateLabel: string | null = null;
    if (date) {
      const dt = new Date(date + "T12:00:00Z");
      selectedDateLabel = `${DAY_NAME[dt.getUTCDay()]}, ${dt.getUTCDate()} ${
        MONTH_NAME[dt.getUTCMonth()]
      } ${dt.getUTCFullYear()}`;
    }

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

    return { data: { date, slot, dates, selectedDateLabel, slots } };
  },
});

export default define.page<typeof handler>(function Embed({ data, state }) {
  const { date, slot, dates, selectedDateLabel, slots } = data;
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
        selectedDateLabel={selectedDateLabel}
        selectedSlot={slot}
        durationMin={cfg.slotDurationMin}
      />
    </main>
  );
});
