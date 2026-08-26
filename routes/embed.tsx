import { define } from "../lib/utils.ts";
import { Picker } from "../components/Picker.tsx";
import { countSlotsForDate, getCandidateDates } from "../lib/availability.ts";
import { isoDateInTz, minToHHMM, zonedDateTime } from "../lib/tz.ts";

interface DateCell {
  date: string;
  slots: number;
}

interface EmbedData {
  date: string | null;
  slot: string | null;
  dates: DateCell[];
  selectedDateLabel: string | null;
  slots: Array<{ time: string; available: boolean }>;
  monthAnchor: string;
}

function parseDateParam(v: string | null): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function parseSlotParam(v: string | null): string | null {
  if (!v) return null;
  if (!/^\d{2}:\d{2}$/.test(v)) return null;
  return v;
}

function parseMonthParam(v: string | null): string | null {
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

export const handler = define.handlers({
  GET(ctx) {
    const cfg = ctx.state.config;
    const url = new URL(ctx.req.url);
    const date = parseDateParam(url.searchParams.get("date"));
    const slot = parseSlotParam(url.searchParams.get("slot"));
    const monthParam = parseMonthParam(url.searchParams.get("month"));

    const minStart = minStartInstant(cfg.minNoticeHours);
    const today = isoDateInTz(new Date(), cfg.hostTz);
    const candidates = getCandidateDates(
      today,
      cfg.bookingHorizonDays,
      cfg.hostTz,
    );

    const monthAnchor = monthParam
      ? monthParam
      : date
      ? date.slice(0, 8) + "01"
      : today.slice(0, 8) + "01";

    const dates: DateCell[] = candidates.map((d) => {
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

    return {
      data: { date, slot, dates, selectedDateLabel, slots, monthAnchor },
    };
  },
});

/*
  Embed variant — used inside an <iframe> on someone else's site.

  Differences from /:
    - No header chrome, no footer, no theme toggle (parent page owns
      the theme; the iframe inherits its color-scheme automatically).
    - Tighter padding — embedders get a smaller drop-in.
    - Same booking flow, same URL contract.

  Auto-sizing: the parent page should set `style="width:100%;max-width:36rem"`
  on the iframe and listen to postMessage if they want dynamic height.
*/
export default define.page<typeof handler>(function Embed({ data, state }) {
  const { date, slot, dates, selectedDateLabel, slots, monthAnchor } = data;
  const cfg = state.config;

  // Pre-compute the confirm label for the picker.
  const confirmLabel = (() => {
    if (!date || !slot) return null;
    const dt = zonedDateTime(date, slot, cfg.hostTz);
    const weekday = new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.hostTz,
      weekday: "short",
    }).format(dt);
    const day = new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.hostTz,
      day: "numeric",
    }).format(dt);
    const month = new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.hostTz,
      month: "short",
    }).format(dt);
    return `Confirm — ${weekday}, ${day} ${month}, ${slot}`;
  })();

  return (
    <div class="min-h-dvh bg-surface text-ink">
      <main class="px-4 sm:px-5 py-4 sm:py-5">
        <header class="mb-4">
          <h1 class="text-base font-semibold tracking-(--tracking-tight) text-ink">
            Book {cfg.hostName}
          </h1>
        </header>

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
          error={null}
          confirmLabel={confirmLabel}
        />
      </main>
    </div>
  );
});
