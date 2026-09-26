import { define } from "../../lib/utils.ts";
import BookingFlow from "../../islands/BookingFlow.tsx";
import { gridDay } from "../../components/TimeSlots.tsx";
import {
  countSlotsForDate,
  getCandidateDates,
} from "../../lib/availability.ts";
import { isoDateInTz, minToHHMM, zonedDateTime } from "@spy4x/time/tz";
import {
  canonicalValidTimeZoneOrNull,
  EARLIEST_DATE,
  formatGridHeader,
  formatShortDateAt,
  formatSlotDisplay,
  hostSlotInstant,
  isCalendarDateTime,
} from "../../lib/clock.ts";
import { embedTzRedirectScript } from "../../lib/guest-tz-script.ts";
import { parseThemeParam } from "../../lib/theme.ts";
import {
  HEIGHT_ATTR,
  heightReportScript,
} from "../../lib/height-report-script.ts";

interface DateCell {
  date: string;
  slots: number;
}

interface SlotCell {
  time: string;
  available: boolean;
  /** "HH:MM" in the display zone (visitor's zone when known, host's
   *  otherwise — mig#15, mig#48). The grid shows the zone itself once,
   *  in its header — see `EmbedData.zoneLabel`. */
  displayHHMM?: string;
  /** This slot's own full "HH:MM, City, UTC±N" (mig#15, mig#48) — the
   *  accessible name only, never the visible text. */
  ariaZoneLabel?: string;
  /** This slot's own UTC offset, set only when it differs from the
   *  header's `zoneLabel` — a daylight-saving change landing on one
   *  of the visible slots (mig#48). */
  offsetNote?: string;
  /** "Wed 23 Sep" — set only when this slot's visitor-local date
   *  differs from the heading's day (mig#15 review, mig#50), so a slot that
   *  wraps to the previous or next day still tells the visitor which
   *  day it actually falls on. */
  dateNote?: string;
}

export interface EmbedData {
  date: string | null;
  slot: string | null;
  dates: DateCell[];
  /** Sorted by instant, each labelled in the display zone. BookingFlow
   *  derives the day label, the grid header and the time card's date
   *  from these, the same way it does on `/`. */
  slots: SlotCell[];
  monthAnchor: string;
  error: string | null;
  /** The visitor's IANA zone, once known from the `tz` query param
   *  (mig#15), canonicalized (canonicalValidTimeZoneOrNull) so a
   *  legacy alias or odd casing in the URL always resolves to one
   *  real zone. An invalid or missing value is `null` and always
   *  falls back to the host's zone rather than an error page. */
  tz: string | null;
  /** /embed's forced theme (mig#44), parsed from `?theme=` and
   *  normalized so "auto" (missing, invalid, or explicitly "auto")
   *  becomes `null` — the same shape `tz` already has, so it threads
   *  through BookingFlow's links and BookingForm's hidden field the same
   *  way. `routes/_app.tsx` reads the raw query param itself to apply
   *  the theme before first paint; this is only for carrying the
   *  choice forward through the rest of the flow. */
  theme: "light" | "dark" | null;
}

function parseDateParam(v: string | null, hostTz: string): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  // Before 1980 some zones' offsets had seconds (see EARLIEST_DATE), and
  // "2026-02-31" is not a date at all (mig#57).
  if (v < EARLIEST_DATE) return null;
  if (!isCalendarDateTime(v, "12:00", hostTz)) return null;
  return v;
}

function parseSlotParam(v: string | null): string | null {
  if (!v) return null;
  if (!/^\d{2}:\d{2}$/.test(v)) return null;
  if (!isCalendarDateTime("2000-01-01", v)) return null; // "24:00" (mig#57)
  return v;
}

function parseMonthParam(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) return null;
  const yyyy = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (yyyy < 1900 || yyyy > 2999 || mm < 1 || mm > 12) return null;
  // The month grid runs the host zone's math on every day it shows,
  // which throws for Dublin's 1900-01 (see EARLIEST_DATE, mig#57).
  if (`${m[1]}-${m[2]}-01` < EARLIEST_DATE) return null;
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
    const date = parseDateParam(url.searchParams.get("date"), cfg.hostTz);
    const slot = parseSlotParam(url.searchParams.get("slot"));
    const monthParam = parseMonthParam(url.searchParams.get("month"));
    const error = url.searchParams.get("err");

    // Visitor timezone (mig#15) — the slot list has to render in the
    // visitor's zone from the first paint, not just at submit, and
    // without JavaScript BookingFlow never re-labels it client-side.
    // Canonicalized + validated the same way `guestTz` is on submit (lib/validators.ts): an invalid or missing value falls
    // back to `null` (host zone), never an error page.
    const tz = canonicalValidTimeZoneOrNull(url.searchParams.get("tz"));
    const displayTz = tz ?? cfg.hostTz;

    // Forced theme (mig#44) — normalized to null for "auto" so it
    // threads through BookingFlow the same way `tz` does
    // (see the EmbedData.theme doc comment).
    const themeParam = parseThemeParam(url.searchParams.get("theme"));
    const theme = themeParam === "auto" ? null : themeParam;

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

    let slots: SlotCell[] = [];
    if (date && !cfg.blockedDates.has(date)) {
      const dayBookings = ctx.state.bookings.forDate(date);
      const dayName = dayNameFromDate(date, cfg.hostTz);
      const ranges = cfg.weeklyAvailability[dayName];
      const booked = new Set(
        dayBookings.filter((b) => b.status === "active").map((b) => b.time),
      );
      const withInstant: Array<
        { time: string; available: boolean; instant: Date }
      > = [];
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
          withInstant.push({
            time,
            available: !booked.has(time) && instant >= minStart,
            instant,
          });
        }
      }
      // Sorted by instant (mig#15 review) — host-local generation order
      // already happens to be instant-ordered for a single host day,
      // but making the sort explicit means a slot that wraps into the
      // previous or next visitor-local day still renders in true
      // chronological order rather than relying on that coincidence.
      // This is also the actual display order, so the grid header
      // offset (below, and BookingFlow's own header) is taken from the
      // FIRST slot *after* this sort.
      withInstant.sort((a, b) => a.instant.getTime() - b.instant.getTime());

      const header = formatGridHeader(
        withInstant.map((s) => s.instant),
        displayTz,
      );
      const day = gridDay(withInstant.map((s) => s.instant), date, displayTz);

      slots = withInstant.map((s) => {
        const visitorDate = isoDateInTz(s.instant, displayTz);
        const display = formatSlotDisplay(s.instant, displayTz, header!.offset);
        return {
          time: s.time,
          available: s.available,
          displayHHMM: display.hhmm,
          ariaZoneLabel: display.ariaZoneLabel,
          offsetNote: display.offsetNote,
          dateNote: visitorDate !== day.date
            ? formatShortDateAt(s.instant, displayTz)
            : undefined,
        };
      });
    }

    return {
      data: {
        date,
        slot,
        dates,
        slots,
        monthAnchor,
        error,
        tz,
        theme,
      },
    };
  },
});

/*
  Embed variant — used inside an <iframe> on someone else's site.

  Differences from /:
    - No header chrome, no footer, no theme toggle (the parent page
      picks the theme via `?theme=`, not the iframe's own
      prefers-color-scheme — an iframe's `prefers-color-scheme`
      follows the *visitor's* OS, not the embedding page, so it never
      actually matched a dark host page on its own; see mig#44 and
      routes/_app.tsx).
    - The same BookingFlow island as / (mig#85), with basePath
      "/embed": once hydrated, picking a day or a time changes the
      view without a page load. Before hydration, or without
      JavaScript, it renders plain <a href> / <form> — every link,
      pushed address and the booking form action stay under /embed,
      so a host that only allows framing /embed never gets navigated
      out of it (issue #11). The island's script and /api/slots load
      from mig's own origin as subresources, which `frame-ancestors`
      doesn't govern.
    - Tighter padding — embedders get a smaller drop-in.
    - Same booking flow, same URL contract, offset by /embed.
    - Timezone (mig#15): every link the flow renders carries `?tz=`
      once known, and the very first load (no `tz` yet) emits a tiny
      script that redirects once to the same URL with the visitor's
      detected zone appended — see lib/guest-tz-script.ts for why a
      query param was chosen over a cookie.
    - Theme (mig#44): `?theme=dark|light` forces that theme (applied
      before first paint by routes/_app.tsx); `?theme=auto` or no
      param keeps today's behaviour. Every link and the confirm form
      carry the forced theme forward the same way `tz` does — see
      lib/picker-links.ts and BookingForm's hidden `theme` field.
    - No mobile summary bar: it's fixed to the frame's bottom, and the
      frame grows to its content, so it would cover the last slots.

  Auto-sizing (mig#44): every /embed page posts its content height to
  `window.parent` via `postMessage` (lib/height-report-script.ts) —
  the parent page listens and sets the iframe's height from it. Its
  ResizeObserver also catches every step BookingFlow renders without a
  page load. See docs/embedding.md for the parent-side listener.
*/
export default define.page<typeof handler>(function Embed({ data, state }) {
  const { date, slot, dates, slots, monthAnchor, error, tz, theme } = data;
  const cfg = state.config;

  return (
    // data-mig-height (mig#44, HEIGHT_ATTR) marks the element
    // heightReportScript measures — its own getBoundingClientRect(),
    // not the document's scrollHeight, so a step that shrinks (e.g.
    // Change back to the date step) reports a smaller height instead
    // of a high-water mark. See lib/height-report-script.ts's header
    // comment for the full reasoning.
    <div class="bg-surface text-ink" {...{ [HEIGHT_ATTR]: "" }}>
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
      {
        /* mig#44 — reports this page's content height to the parent
           on load and on every resize, so the parent can size the
           iframe to fit instead of carrying a fixed height that clips
           the confirm step. See lib/height-report-script.ts. */
      }
      <script
        dangerouslySetInnerHTML={{ __html: heightReportScript() }}
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

        <BookingFlow
          dates={dates}
          slots={slots}
          selectedDate={date}
          selectedSlot={slot}
          monthAnchor={monthAnchor}
          durationMin={cfg.slotDurationMin}
          hostName={cfg.hostName}
          hostTz={cfg.hostTz}
          error={error}
          tz={tz}
          basePath="/embed"
          theme={theme}
        />
      </main>
    </div>
  );
});
