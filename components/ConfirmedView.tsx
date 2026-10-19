/*
  ConfirmedView — the body of /confirmed, shared with /embed/confirmed.

  Three states: not-ok (missing/invalid/expired link), cancelled, and
  booked. Each returns its own <main> (kept from the original
  standalone page so the per-state padding stays intact); the caller
  supplies the surrounding shell (Header/Footer on the standalone
  page, a plain <div> on /embed — see routes/confirmed.tsx and
  routes/embed/confirmed.tsx).

  `backHref` and `cancelTarget` are how the two callers diverge
  without duplicating this markup:
    - standalone: backHref="/",      cancel link opens in the same tab
    - /embed:     backHref="/embed", cancel link opens in a new tab
                  (rel=noopener) — /cancel is a standalone page a host
                  that only allows framing /embed would refuse to
                  render inside the iframe (issue #11). The meeting
                  link already opens in a new tab on both.
*/

import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { ErrorState } from "@spy4x/preact-ui/error-state"
import { canonicalTimeZoneOr, isValidTimeZone } from "@spy4x/time/tz"
import { formatHostClockIn, formatHostDateIn } from "../lib/clock.ts"
import { IconCheck, IconMinus } from "@spy4x/preact-icons"
import type { ComponentChildren } from "preact"
import type { ConfirmedBooking, ConfirmedData } from "../lib/confirmed-data.ts"

export interface ConfirmedViewProps extends ConfirmedData {
  hostName: string
  meetingUrl: string
  slotDurationMin: number
  /** Where "back to booking" / "book another time" links go. */
  backHref: string
  /** Set to "_blank" to open the cancel link in a new tab. Omitted on
   *  the standalone page. */
  cancelTarget?: "_blank"
  /** <main> classes for the cancelled state. Defaults to the
   *  standalone page's original `px-6 py-16` (matches the not-ok
   *  state) so the standalone page renders as it did before this
   *  component existed. /embed passes a tighter class list to
   *  match its own denser layout. */
  cancelledMainClass?: string
  /** id for every state's <main>. The standalone page's own <main>
   *  never had one (matching routes/index.tsx would be a separate,
   *  pre-existing gap this issue doesn't cover), so this defaults to
   *  undefined there; /embed passes "main" so its Skip-to-content
   *  link (routes/_app.tsx, #main) has a target on every state of
   *  /embed/confirmed, not just the picker. */
  mainId?: string
}

const DEFAULT_CANCELLED_MAIN_CLASS = "flex-1 px-4 py-12 sm:px-6"

export function ConfirmedView(props: ConfirmedViewProps) {
  const {
    state,
    mode,
    booking,
    hostName,
    meetingUrl,
    slotDurationMin,
    backHref,
    cancelTarget,
    cancelledMainClass = DEFAULT_CANCELLED_MAIN_CLASS,
    mainId,
  } = props

  if (state !== "ok" || !booking) {
    // One message for a missing, tampered or unknown link: the visitor
    // can do the same thing about each, and the difference tells a
    // stranger nothing they need.
    return (
      <main id={mainId} class="flex-1 px-4 py-12 sm:px-6">
        <div class="mx-auto w-full max-w-md text-center">
          <ErrorState message="We couldn't find this booking. Check the link in your email." />
          <div class="mt-6">
            <Button href={backHref}>Book a time</Button>
          </div>
        </div>
      </main>
    )
  }

  const b: ConfirmedBooking = booking
  // Display the booking time in the visitor's TZ when we captured one
  // at submit time. Falls back to host TZ when guestTz is missing or
  // invalid (older bookings, bad data, hidden legacy paths, or a
  // visitor who booked without JavaScript on /embed). The page is
  // server-rendered — we have access to guestTz from the booking
  // record, no client Intl needed.
  //
  // mig#15: both helpers take `b.hostTz` (the zone `b.date`/`b.time`
  // are actually stored in) alongside `displayTz` (the zone to show
  // them in) — they used to be called with `displayTz` for both,
  // which built the instant in the wrong zone and silently skipped
  // the conversion.
  const knownGuestTz = !!b.guestTz && isValidTimeZone(b.guestTz)
  const displayTz = canonicalTimeZoneOr(b.guestTz ?? undefined, b.hostTz)
  const dateLabel = formatHostDateIn(b.date, b.time, b.hostTz, displayTz)
  const timeLabel = formatHostClockIn(b.date, b.time, b.hostTz, displayTz)
  const hostTzNote = !knownGuestTz && (
    <p class="mt-1 text-sm text-muted">
      Times are shown in the host's timezone.
    </p>
  )

  if (mode === "cancelled") {
    return (
      <main id={mainId} class={cancelledMainClass}>
        <div class="mx-auto w-full max-w-md text-center">
          <div class="mb-4 inline-flex size-12 items-center justify-center rounded-full border border-subtle bg-surface text-muted">
            <IconMinus class="size-6" />
          </div>
          <h1 class="text-2xl font-semibold tracking-tight text-balance text-foreground">
            This booking was cancelled
          </h1>
          <p class="mt-2 text-sm text-muted tabular-nums">
            {dateLabel} · {timeLabel}
          </p>
          {hostTzNote}
          {b.cancelledReason && (
            <p class="mt-3 text-sm text-pretty break-words text-muted">
              {`“${b.cancelledReason}”`}
            </p>
          )}
          <p class="mt-3 text-sm text-muted">
            Both you and {hostName} have been notified.
          </p>
          <div class="mt-6">
            <Button href={backHref}>Book a new time</Button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main id={mainId} class="flex-1 px-4 py-12 sm:px-6">
      <div class="mx-auto w-full max-w-md">
        <div class="text-center">
          <div class="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
            <IconCheck class="size-6" />
          </div>
          <h1 class="text-2xl font-semibold tracking-tight text-balance text-foreground">
            You're booked with {hostName}
          </h1>
          <p class="mt-2 text-sm text-pretty text-muted">
            We sent the details and a calendar invite to{" "}
            <span class="font-medium break-words text-foreground">
              {b.guestEmail}
            </span>.
          </p>
        </div>

        <Card class="mt-6">
          <dl class="divide-y divide-subtle">
            <Detail label="Date" value={dateLabel} />
            <Detail label="Time" value={timeLabel} />
            <Detail label="Duration" value={`${slotDurationMin} minutes`} />
            <Detail
              label="Join"
              value={
                <a
                  href={meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="break-all text-foreground underline underline-offset-2 hover:text-muted"
                >
                  {meetingUrl}
                </a>
              }
            />
          </dl>
        </Card>

        {!knownGuestTz && (
          <p class="mt-3 text-center text-sm text-muted">
            Times are shown in the host's timezone.
          </p>
        )}

        <div class="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button href={backHref} variant="outline" class="min-h-11 sm:min-h-9">
            Book another time
          </Button>
          <Button
            href={`/cancel?id=${b.id}&token=${b.cancelToken}`}
            target={cancelTarget}
            rel={cancelTarget ? "noopener noreferrer" : undefined}
            variant="ghost"
            class="min-h-11 sm:min-h-9"
          >
            Cancel booking
          </Button>
        </div>
      </div>
    </main>
  )
}

/** One row of the booking's details: the label left, the value right. */
function Detail(
  { label, value }: { label: string; value: ComponentChildren },
) {
  return (
    <div class="flex items-baseline justify-between gap-4 px-4 py-3 text-sm sm:px-6">
      <dt class="shrink-0 text-muted">{label}</dt>
      <dd class="min-w-0 text-right text-foreground tabular-nums">{value}</dd>
    </div>
  )
}
