import { define } from "../lib/utils.ts";
import { Header } from "../components/Header.tsx";
import { Footer } from "../components/Footer.tsx";
import { Picker } from "../components/Picker.tsx";
import { SummaryBar } from "../components/SummaryBar.tsx";
import { countSlotsForDate, getCandidateDates } from "../lib/availability.ts";
import { isoDateInTz, minToHHMM, zonedDateTime } from "../lib/tz.ts";

interface IndexData {
  date: string | null;
  slot: string | null;
  dates: Array<{ date: string; slots: number }>;
  selectedDateLabel: string | null;
  slots: Array<{ time: string; available: boolean }>;
  error: string | null;
  monthAnchor: string;
}

function parseDateParam(v: string | null): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
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

function parseMonthParam(v: string | null): string | null {
  // Accept both "YYYY-MM" and "YYYY-MM-DD" (anchor on the 1st).
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) return null;
  const yyyy = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (yyyy < 1900 || yyyy > 2999 || mm < 1 || mm > 12) return null;
  return `${m[1]}-${m[2]}-01`;
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

export default define.page(function Index(ctx) {
  const cfg = ctx.state.config;
  const url = new URL(ctx.req.url);
  const date = parseDateParam(url.searchParams.get("date"));
  const slot = parseSlotParam(url.searchParams.get("slot"));
  const error = url.searchParams.get("err");
  const monthParam = parseMonthParam(url.searchParams.get("month"));

  const minStart = minStartInstant(cfg.minNoticeHours);
  const today = isoDateInTz(new Date(), cfg.hostTz);
  const candidates = getCandidateDates(
    today,
    cfg.bookingHorizonDays,
    cfg.hostTz,
  );

  // monthAnchor: the month to display in the calendar.
  // - If ?month=… is set and within range, use it.
  // - If ?date=… is set, anchor on that date's month.
  // - Otherwise anchor on today's month.
  const monthAnchor = (() => {
    if (monthParam) return monthParam;
    if (date) return date.slice(0, 8) + "01";
    return today.slice(0, 8) + "01";
  })();

  const dates = candidates.map((d) => {
    const blocked = cfg.blockedDates.has(d);
    const bookedCount = blocked
      ? 999
      : ctx.state.bookings.forDate(d).filter((b) => b.status === "active")
        .length;
    const slots = blocked ? 0 : countSlotsForDate(
      d,
      cfg.weeklyAvailability,
      cfg.slotDurationMin,
      bookedCount,
      cfg.hostTz,
      minStart,
    );
    return { date: d, slots };
  });

  let selectedDateLabel: string | null = null;
  if (date) {
    const dt = zonedDateTime(date, "12:00", cfg.hostTz);
    selectedDateLabel = new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.hostTz,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(dt);
  }

  const slots: IndexData["slots"] = [];
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

  const summaryState: "none" | "date" | "slot" = slot
    ? "slot"
    : date
    ? "date"
    : "none";

  return (
    <div class="min-h-dvh flex flex-col">
      <Header hostName={cfg.hostName} hostTz={cfg.hostTz} />

      <main id="main" class="flex-1">
        <div class="mx-auto w-full max-w-2xl px-4 sm:px-6 pt-8 sm:pt-12 pb-24 md:pb-16">
          <Hero
            hostName={cfg.hostName}
            hostTz={cfg.hostTz}
            durationMin={cfg.slotDurationMin}
          />

          <div class="mt-6">
            <Picker
              dates={dates}
              slots={slots}
              selectedDate={date}
              selectedDateLabel={selectedDateLabel}
              selectedSlot={slot}
              monthAnchor={monthAnchor}
              durationMin={cfg.slotDurationMin}
              hostName={cfg.hostName}
              hostTz={cfg.hostTz}
              error={error}
            />
          </div>
        </div>
      </main>

      <Footer githubUrl={cfg.githubUrl} hidden={cfg.hideBranding} />

      <SummaryBar
        state={summaryState}
        date={date}
        dateLabel={selectedDateLabel}
        slot={slot}
      />
    </div>
  );
});

function Hero(
  { hostName, hostTz, durationMin }: {
    hostName: string;
    hostTz: string;
    durationMin: number;
  },
) {
  return (
    <section class="space-y-2.5">
      <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-600 dark:text-brand-300">
        Book a meeting
      </p>
      <h1 class="text-[26px] sm:text-3xl font-semibold tracking-(--tracking-display) text-ink leading-[1.1] text-balance">
        {hostName}
      </h1>
      <p class="text-sm text-ink-muted max-w-md">
        {durationMin}-minute call. Pick a time that works for you —{" "}
        <span class="text-ink-subtle">shown in {hostTz}.</span>
      </p>
    </section>
  );
}
