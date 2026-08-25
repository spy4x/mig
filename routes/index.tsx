import { define } from "../lib/utils.ts";
import { ThemeToggle } from "../islands/ThemeToggle.tsx";
import { BookingPicker } from "../components/BookingPicker.tsx";
import { countSlotsForDate, getCandidateDates } from "../lib/availability.ts";
import { minToHHMM, zonedDateTime } from "../lib/tz.ts";

interface IndexData {
  date: string | null;
  slot: string | null;
  dates: Array<{ date: string; label: string; slots: number; full: boolean }>;
  slots: Array<{ time: string; available: boolean }>;
  error: string | null;
}

// Parse a YYYY-MM-DD query param defensively.
function parseDateParam(v: string | null): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  // Range check (year 1900-2999, month 1-12, day 1-31 — rough)
  const [y, m, d] = v.split("-").map(Number);
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return v;
}

function parseSlotParam(v: string | null): string | null {
  if (!v) return null;
  if (!/^\d{2}:\d{2}$/.test(v)) return null;
  const [h, m] = v.split(":").map(Number);
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  return v;
}

function minStartInstant(hours: number): Date {
  return new Date(Date.now() + hours * 3600_000);
}

export const handler = define.handlers({
  GET(ctx) {
    const cfg = ctx.state.config;
    const url = new URL(ctx.req.url);
    const date = parseDateParam(url.searchParams.get("date"));
    const slot = parseSlotParam(url.searchParams.get("slot"));
    const error = url.searchParams.get("err");

    const now = new Date();
    const minStart = minStartInstant(cfg.minNoticeHours);

    // Generate candidate dates (today + horizon)
    const today = now.toISOString().slice(0, 10); // approx; refine per tz below
    const candidates = getCandidateDates(today, cfg.bookingHorizonDays, "UTC");

    // For each candidate, count available slots. Skip if no availability
    // for that day-of-week, or if blocked.
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

    // If user picked a date, compute slots for it.
    const slots: IndexData["slots"] = [];
    if (date && !cfg.blockedDates.has(date)) {
      const dayBookings = ctx.state.bookings.forDate(date);
      // Re-compute slot list inline (avoid pulling availability helper again)
      // Use a minimal implementation: expand availability ranges and check.
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

    return {
      data: { date, slot, dates, slots, error },
    };
  },
});

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

export default define.page<typeof handler>(function Index({ data, state }) {
  const { date, slot, dates, slots, error } = data;
  const cfg = state.config;
  return (
    <main
      id="main"
      class="min-h-screen flex flex-col items-center px-4 py-10 sm:py-16"
    >
      <header class="w-full max-w-2xl flex items-center justify-between mb-8">
        <a
          href="/"
          class="text-orange-500 font-semibold text-lg tracking-tight"
        >
          mig
        </a>
        <ThemeToggle initial={cfg.theme} />
      </header>

      <section class="w-full max-w-2xl">
        <h1 class="text-2xl sm:text-3xl font-semibold text-slate-100 mb-2">
          Book a meeting with {cfg.hostName}
        </h1>
        <p class="text-slate-400 mb-8">
          {cfg.slotDurationMin}-minute call. Pick a time that works for you.
        </p>

        {error && <ErrorBanner message={error} />}

        <BookingPicker
          dates={dates}
          slots={slots}
          selectedDate={date}
          selectedSlot={slot}
          durationMin={cfg.slotDurationMin}
          hostTz={cfg.hostTz}
          publicUrl={cfg.publicUrl}
        />
      </section>

      <footer class="w-full max-w-2xl mt-12 pt-6 border-t border-slate-800 text-slate-500 text-sm flex items-center justify-between">
        <span>Powered by mig</span>
        <a
          href="/embed"
          class="hover:text-slate-300 transition-colors"
          title="Use this on your own site"
        >
          embed
        </a>
      </footer>
    </main>
  );
});

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      class="mb-6 px-4 py-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 text-sm"
    >
      {message}
    </div>
  );
}
