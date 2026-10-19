import { define } from "../lib/utils.ts"
import { Header } from "../components/Header.tsx"
import { Footer } from "../components/Footer.tsx"
import BookingFlow from "../islands/BookingFlow.tsx"
import { gridDay } from "../components/TimeSlots.tsx"
import { getCandidateDates, offeredSlots } from "../lib/availability.ts"
import { canonicalValidTimeZoneOrNull, isoDateInTz } from "@spy4x/time/tz"
import {
  EARLIEST_DATE,
  formatGridHeader,
  formatShortDateAt,
  formatSlotDisplay,
  isCalendarDateTime,
} from "../lib/clock.ts"

interface IndexData {
  date: string | null
  slot: string | null
  dates: Array<{ date: string; slots: number }>
  slots: Array<
    {
      time: string
      available: boolean
      displayHHMM?: string
      ariaZoneLabel?: string
      offsetNote?: string
      dateNote?: string
    }
  >
  error: string | null
  monthAnchor: string
}

function parseDateParam(v: string | null, hostTz: string): string | null {
  if (!v) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  // Before 1980 some zones' offsets had seconds (see EARLIEST_DATE), and
  // "2026-02-31" is not a date at all (mig#57).
  if (v < EARLIEST_DATE) return null
  if (!isCalendarDateTime(v, "12:00", hostTz)) return null
  const [y, m, d] = v.split("-").map(Number)
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null
  return v
}

function parseSlotParam(v: string | null): string | null {
  if (!v) return null
  if (!/^\d{2}:\d{2}$/.test(v)) return null
  if (!isCalendarDateTime("2000-01-01", v)) return null // "24:00" (mig#57)
  const [h, m] = v.split(":").map(Number)
  if (h < 0 || h > 24 || m < 0 || m > 59) return null
  return v
}

function parseMonthParam(v: string | null): string | null {
  if (!v) return null
  const m = v.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/)
  if (!m) return null
  const yyyy = parseInt(m[1], 10)
  const mm = parseInt(m[2], 10)
  if (yyyy < 1900 || yyyy > 2999 || mm < 1 || mm > 12) return null
  // The month grid runs the host zone's math on every day it shows,
  // which throws for Dublin's 1900-01 (see EARLIEST_DATE, mig#57).
  if (`${m[1]}-${m[2]}-01` < EARLIEST_DATE) return null
  return `${m[1]}-${m[2]}-01`
}

export default define.page(function Index(ctx) {
  const cfg = ctx.state.config
  const url = new URL(ctx.req.url)
  const date = parseDateParam(url.searchParams.get("date"), cfg.hostTz)
  const slot = parseSlotParam(url.searchParams.get("slot"))
  const error = url.searchParams.get("err")
  const monthParam = parseMonthParam(url.searchParams.get("month"))

  // Visitor timezone (mig#18) — read and validated the same way
  // routes/embed/index.tsx does, so a visitor who arrives at "/" with
  // a shared `?tz=` link (or before BookingFlow's own hydration runs)
  // sees every clock and date in their own zone from the first paint,
  // not the host's. An invalid or missing value falls back to `null`
  // (host zone), never an error page — same contract as /embed.
  const tz = canonicalValidTimeZoneOrNull(url.searchParams.get("tz"))
  const displayTz = tz ?? cfg.hostTz

  const now = new Date()
  const today = isoDateInTz(now, cfg.hostTz)
  const candidates = getCandidateDates(
    today,
    cfg.bookingHorizonDays,
    cfg.hostTz,
  )

  // monthAnchor: the month to display in the calendar.
  // - If ?month=… is set and within range, use it.
  // - If ?date=… is set, anchor on that date's month.
  // - Otherwise anchor on today's month.
  const monthAnchor = (() => {
    if (monthParam) return monthParam
    if (date) return date.slice(0, 8) + "01"
    return today.slice(0, 8) + "01"
  })()

  const dates = candidates.map((d) => {
    // offeredSlots gives nothing for a blocked date or one past the horizon.
    const slots = offeredSlots(cfg, d, ctx.state.bookings.forDate(d), now)
      .filter((s) => s.available).length
    return { date: d, slots }
  })

  // Every slot's instant, host-chronological order (mig#48 review) —
  // this route doesn't reorder slots across a visitor-local midnight
  // the way /embed and BookingFlow do after mount, so display order
  // before hydration is exactly this push order. `formatGridHeader`
  // below takes the FIRST of these — the first slot actually shown —
  // not an arbitrary anchor like noon of the host day, which can
  // label the header with an offset no visible slot has.
  const daySlots = date
    ? offeredSlots(cfg, date, ctx.state.bookings.forDate(date), now)
    : []

  const header = formatGridHeader(
    daySlots.map((s) => s.instant),
    displayTz,
  )

  // Labelled in the display zone (mig#18: the `tz` query param when
  // known, host zone otherwise). BookingFlow's hydration replaces this
  // with the browser-detected zone once mounted; a no-JS visitor, or
  // the pre-hydration first paint, keeps this one, which is why it
  // never silently reverts to the host's zone when the visitor arrived
  // with a `?tz=` already set. Only HH:MM shows on the slot itself —
  // the zone renders once, in the grid's header (mig#48) — except when
  // this slot's own offset disagrees with the header's, e.g. a
  // daylight-saving change landing on it. A slot on another day than
  // the one BookingFlow names above the grid (gridDay, mig#50) carries
  // a `dateNote`, as it does after hydration.
  const gridDate = date
    ? gridDay(daySlots.map((s) => s.instant), date, displayTz).date
    : null
  const slots: IndexData["slots"] = daySlots.map((s) => {
    const display = formatSlotDisplay(s.instant, displayTz, header!.offset)
    return {
      time: s.time,
      available: s.available,
      displayHHMM: display.hhmm,
      ariaZoneLabel: display.ariaZoneLabel,
      offsetNote: display.offsetNote,
      dateNote: isoDateInTz(s.instant, displayTz) !== gridDate
        ? formatShortDateAt(s.instant, displayTz)
        : undefined,
    }
  })

  // The BookingFlow island computes its own confirm label (host TZ
  // on SSR, visitor TZ after hydration), so the route doesn't need
  // to pre-compute one.

  return (
    <div class="min-h-dvh flex flex-col">
      <Header defaultTheme={cfg.theme} />

      <main id="main" tabIndex={-1} class="flex-1 outline-hidden">
        <div class="mx-auto w-full max-w-2xl px-4 pt-8 sm:px-6 sm:pt-12">
          <Hero
            hostName={cfg.hostName}
            durationMin={cfg.slotDurationMin}
          />

          {
            /* mig#15 review: only ever rendered when JavaScript is
               unavailable — browsers strip <noscript> content the
               instant JS is enabled, before hydration timing is even
               relevant, so there's no flash either way. When JS *is*
               available, BookingFlow's own hydration silently swaps
               the host-labelled clocks below for the visitor's.

               mig#18: only true, and so only shown, when the display
               zone actually is the host's — a visitor who arrived
               with a valid `?tz=` already sees their own zone above,
               not the host's, so this note would be wrong for them. */
          }
          {displayTz === cfg.hostTz && (
            <noscript>
              <p class="mt-4 text-sm text-muted">
                Times are shown in the host's timezone.
              </p>
            </noscript>
          )}

          <div class="mt-8">
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
            />
          </div>
        </div>
      </main>

      <Footer
        githubUrl={cfg.githubUrl}
        hidden={cfg.hideBranding}
        version={cfg.version}
      />
    </div>
  )
})

/*
  Hero — who the meeting is with, then what it is. The host name is the
  page's h1; the line above it is a quiet sentence-case lead-in.
*/
function Hero(
  { hostName, durationMin }: {
    hostName: string
    durationMin: number
  },
) {
  return (
    <section>
      <p class="text-sm text-muted">Book a meeting with</p>
      <h1 class="mt-1 text-3xl font-semibold tracking-tight text-balance text-foreground">
        {hostName}
      </h1>
      <p class="mt-3 max-w-md text-lg text-pretty text-muted">
        A {durationMin}-minute call. Pick a time that works for you.
      </p>
    </section>
  )
}
