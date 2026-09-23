import { define } from "../../lib/utils.ts";
import { Picker } from "../../components/Picker.tsx";
import {
  countSlotsForDate,
  getCandidateDates,
} from "../../lib/availability.ts";
import {
  canonicalValidTimeZoneOrNull,
  formatClockAt,
  formatDateLong,
  formatShortDateAt,
  isoDateInTz,
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
  /** "Wed 23 Sep" — set only when this slot's visitor-local date
   *  differs from the picked host day (mig#15 review), so a slot that
   *  wraps to the previous or next day still tells the visitor which
   *  day it actually falls on. */
  dateNote?: string;
}

export interface EmbedData {
  date: string | null;
  slot: string | null;
  dates: DateCell[];
  selectedDateLabel: string | null;
  /** The selected slot's own date, built from its exact instant, not
   *  noon of the host day (mig#15 review) — e.g. "Wednesday, 23
   *  September 2026" for a 09:00 Thursday Ho Chi Minh slot shown to a
   *  New York visitor as 22:00 Wednesday. Feeds TimeCard specifically;
   *  `selectedDateLabel` (noon-based) still feeds DateCard, which
   *  shows the *picked calendar day*, not a specific time. */
  slotDateLabel: string | null;
  slots: SlotCell[];
  monthAnchor: string;
  error: string | null;
  /** The visitor's IANA zone, once known from the `tz` query param
   *  (mig#15), canonicalized (canonicalValidTimeZoneOrNull) so a
   *  legacy alias or odd casing in the URL always resolves to one
   *  real zone. An invalid or missing value is `null` and always
   *  falls back to the host's zone rather than an error page. */
  tz: string | null;
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
    // (issue #11). Canonicalized + validated the same way `guestTz` is
    // on submit (lib/validators.ts): an invalid or missing value falls
    // back to `null` (host zone), never an error page.
    const tz = canonicalValidTimeZoneOrNull(url.searchParams.get("tz"));
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
    // the same way the standalone island does (both now call
    // lib/tz.ts's formatDateLong with "12:00" — noon of the
    // host-local date, formatted in displayTz): the calendar grid
    // itself stays host-anchored (mig#15 allows this for the month
    // grid), but the single picked day's own label reads correctly in
    // the visitor's zone.
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

    // The selected slot's own date, from its exact instant — see the
    // EmbedData.slotDateLabel doc comment (mig#15 review).
    const slotDateLabel = date && slot
      ? formatDateLong(date, slot, cfg.hostTz, displayTz)
      : null;

    let slots: SlotCell[] = [];
    if (date && !cfg.blockedDates.has(date)) {
      const dayBookings = ctx.state.bookings.forDate(date);
      const dayName = dayNameFromDate(date, cfg.hostTz);
      const ranges = cfg.weeklyAvailability[dayName];
      const booked = new Set(
        dayBookings.filter((b) => b.status === "active").map((b) => b.time),
      );
      const withInstant: Array<SlotCell & { instant: Date }> = [];
      for (const r of ranges) {
        for (
          let m = r.startMin;
          m <= r.endMin - cfg.slotDurationMin;
          m += cfg.slotDurationMin
        ) {
          const time = minToHHMM(m);
          const instant = zonedDateTime(date, time, cfg.hostTz);
          const visitorDate = isoDateInTz(instant, displayTz);
          withInstant.push({
            time,
            instant,
            available: !booked.has(time) && instant >= minStart,
            displayTime: formatClockAt(instant, displayTz),
            dateNote: visitorDate !== date
              ? formatShortDateAt(instant, displayTz)
              : undefined,
          });
        }
      }
      // Sorted by instant (mig#15 review) — host-local generation order
      // already happens to be instant-ordered for a single host day,
      // but making the sort explicit means a slot that wraps into the
      // previous or next visitor-local day still renders in true
      // chronological order rather than relying on that coincidence.
      withInstant.sort((a, b) => a.instant.getTime() - b.instant.getTime());
      slots = withInstant.map(({ instant: _instant, ...s }) => s);
    }

    return {
      data: {
        date,
        slot,
        dates,
        selectedDateLabel,
        slotDateLabel,
        slots,
        monthAnchor,
        error,
        tz,
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
    slotDateLabel,
    slots,
    monthAnchor,
    error,
    tz,
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
        /* mig#15 — always emitted; the script itself only redirects
           when the browser's detected zone doesn't already match the
           URL's `tz` param, so a correct param (or the very next load
           after a redirect) never loops. See
           lib/guest-tz-script.ts:shouldRedirectTz for the decision. */
      }
      <script
        dangerouslySetInnerHTML={{ __html: embedTzRedirectScript() }}
      />
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
          slotDateLabel={slotDateLabel}
        />
      </main>
    </div>
  );
});
