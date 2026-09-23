import { define } from "../../lib/utils.ts";
import { Picker } from "../../components/Picker.tsx";
import {
  countSlotsForDate,
  getCandidateDates,
} from "../../lib/availability.ts";
import {
  formatClockAt,
  isoDateInTz,
  isValidTimeZone,
  minToHHMM,
  zonedDateTime,
} from "../../lib/tz.ts";
import { embedTzRedirectScript } from "../../lib/guest-tz-script.ts";

interface DateCell {
  date: string;
  slots: number;
}

interface SlotCell {
  time: string;
  available: boolean;
  /** Full "HH:MM, City, UTC±N" clock string in the display zone
   *  (visitor's zone when known, host's otherwise — mig#15). */
  displayTime?: string;
}

export interface EmbedData {
  date: string | null;
  slot: string | null;
  dates: DateCell[];
  selectedDateLabel: string | null;
  slots: SlotCell[];
  monthAnchor: string;
  error: string | null;
  /** The visitor's IANA zone, once known from the `tz` query param
   *  (mig#15). Validated exactly like `guestTz` is validated on
   *  submit (lib/validators.ts) — an invalid value is `null`, the
   *  same as a missing one, and always falls back to the host's zone
   *  rather than an error page. */
  tz: string | null;
  /** True only when `tz` is missing outright (not present-but-invalid)
   *  — the one case where the client-side tz-redirect script should
   *  run, so a bad value never sends the visitor into a loop. */
  showTzRedirect: boolean;
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
    const error = url.searchParams.get("err");

    // Visitor timezone (mig#15) — the slot list has to render in the
    // visitor's zone from the first paint, not just at submit, and
    // /embed mounts no island to do that client-side after the fact
    // (issue #11). Validated the same way `guestTz` is validated on
    // submit: an invalid value is treated the same as a missing one.
    const tzParam = url.searchParams.get("tz");
    const tz = tzParam && isValidTimeZone(tzParam) ? tzParam : null;
    // Only redirect when the param is entirely absent — a
    // present-but-invalid value must not bounce forever.
    const showTzRedirect = tzParam === null;
    const displayTz = tz ?? cfg.hostTz;

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

    // Date label for the picked day. Converted into the display zone
    // the same way the standalone island does (BookingFlow's
    // formatDateLongInTz — noon of the host-local date, formatted in
    // displayTz): the calendar grid itself stays host-anchored
    // (mig#15 allows this for the month grid), but the single picked
    // day's own label reads correctly in the visitor's zone.
    let selectedDateLabel: string | null = null;
    if (date) {
      const dt = zonedDateTime(date, "12:00", cfg.hostTz);
      selectedDateLabel = new Intl.DateTimeFormat("en-GB", {
        timeZone: displayTz,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(dt);
    }

    const slots: SlotCell[] = [];
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
            displayTime: formatClockAt(instant, displayTz),
          });
        }
      }
    }

    return {
      data: {
        date,
        slot,
        dates,
        selectedDateLabel,
        slots,
        monthAnchor,
        error,
        tz,
        showTzRedirect,
      },
    };
  },
});

/*
  Embed variant — used inside an <iframe> on someone else's site.

  Differences from /:
    - No header chrome, no footer, no theme toggle (parent page owns
      the theme; the iframe inherits its color-scheme automatically).
    - No island: the Picker renders plain <a href> / <form> — every
      link and the booking form action stay under /embed (basePath
      below), so a host that only allows framing /embed never gets
      navigated out of it (issue #11).
    - Tighter padding — embedders get a smaller drop-in.
    - Same booking flow, same URL contract, offset by /embed.
    - Timezone (mig#15): every link the Picker renders carries `?tz=`
      once known, and the very first load (no `tz` yet) emits a tiny
      script that redirects once to the same URL with the visitor's
      detected zone appended — see lib/guest-tz-script.ts for why a
      query param was chosen over a cookie.

  Auto-sizing: the parent page should set `style="width:100%;max-width:36rem"`
  on the iframe and listen to postMessage if they want dynamic height.
*/
export default define.page<typeof handler>(function Embed({ data, state }) {
  const {
    date,
    slot,
    dates,
    selectedDateLabel,
    slots,
    monthAnchor,
    error,
    tz,
    showTzRedirect,
  } = data;
  const cfg = state.config;
  const displayTz = tz ?? cfg.hostTz;

  // Pre-compute the confirm label for the picker, in the display zone.
  const confirmLabel = (() => {
    if (!date || !slot) return null;
    const dt = zonedDateTime(date, slot, cfg.hostTz);
    const weekday = new Intl.DateTimeFormat("en-GB", {
      timeZone: displayTz,
      weekday: "short",
    }).format(dt);
    const day = new Intl.DateTimeFormat("en-GB", {
      timeZone: displayTz,
      day: "numeric",
    }).format(dt);
    const month = new Intl.DateTimeFormat("en-GB", {
      timeZone: displayTz,
      month: "short",
    }).format(dt);
    return `Confirm — ${weekday}, ${day} ${month}, ${
      formatClockAt(dt, displayTz)
    }`;
  })();

  const displaySlot = date && slot
    ? formatClockAt(zonedDateTime(date, slot, cfg.hostTz), displayTz)
    : null;

  return (
    <div class="min-h-dvh bg-surface text-ink">
      {
        /* mig#15 — only emitted when `tz` is missing outright, never
           for a present-but-invalid value (that would loop). */
      }
      {showTzRedirect && (
        <script
          dangerouslySetInnerHTML={{ __html: embedTzRedirectScript() }}
        />
      )}
      <main id="main" class="px-4 sm:px-5 py-4 sm:py-5">
        {
          /* A plain <div>, not a <header> element — /embed must not
             contain the site's chrome, and a bare landmark heading
             for "Book {hostName}" isn't that chrome, but keeping it
             out of a <header> tag keeps that easy to verify. */
        }
        <div class="mb-4">
          <h1 class="text-base font-semibold tracking-(--tracking-tight) text-ink">
            Book {cfg.hostName}
          </h1>
          {!tz && (
            <p class="text-xs text-ink-subtle mt-1">
              Times are shown in the host's timezone.
            </p>
          )}
        </div>

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
          confirmLabel={confirmLabel}
          basePath="/embed"
          tz={tz}
          displaySlot={displaySlot}
        />
      </main>
    </div>
  );
});
