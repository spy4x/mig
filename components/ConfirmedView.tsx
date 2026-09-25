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

import { isValidTimeZone } from "@spy4x/time/tz";
import {
  canonicalTimeZoneOr,
  formatHostClockIn,
  formatHostDateIn,
} from "../lib/clock.ts";
import { ArrowLeft, ArrowRight, Check, InfoCircle, Minus } from "./icons.tsx";
import type { ConfirmedBooking, ConfirmedData } from "../lib/confirmed-data.ts";

export interface ConfirmedViewProps extends ConfirmedData {
  hostName: string;
  meetingUrl: string;
  slotDurationMin: number;
  /** Where "back to booking" / "book another time" links go. */
  backHref: string;
  /** Set to "_blank" to open the cancel link in a new tab. Omitted on
   *  the standalone page. */
  cancelTarget?: "_blank";
  /** <main> classes for the cancelled state. Defaults to the
   *  standalone page's original `px-6 py-16` (matches the not-ok
   *  state) so the standalone page renders as it did before this
   *  component existed. /embed passes a tighter class list to
   *  match its own denser layout. */
  cancelledMainClass?: string;
  /** id for every state's <main>. The standalone page's own <main>
   *  never had one (matching routes/index.tsx would be a separate,
   *  pre-existing gap this issue doesn't cover), so this defaults to
   *  undefined there; /embed passes "main" so its Skip-to-content
   *  link (routes/_app.tsx, #main) has a target on every state of
   *  /embed/confirmed, not just the picker. */
  mainId?: string;
}

const DEFAULT_CANCELLED_MAIN_CLASS =
  "flex-1 grid place-items-center px-6 py-16";

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
  } = props;

  if (state !== "ok" || !booking) {
    const title = state === "invalid"
      ? "Invalid or expired link"
      : state === "missing"
      ? "Link missing parameters"
      : "Booking not found";
    const body = state === "invalid"
      ? "The link you used has been tampered with or is no longer valid."
      : "Check the URL and try again, or contact the host.";
    return (
      <main id={mainId} class="flex-1 grid place-items-center px-6 py-16">
        <div class="max-w-sm text-center">
          <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-surface-sunken text-ink-subtle mb-4">
            <InfoCircle />
          </div>
          <h1 class="text-xl font-semibold tracking-(--tracking-tight) text-ink mb-2">
            {title}
          </h1>
          <p class="text-sm text-ink-muted mb-6">{body}</p>
          <a
            href={backHref}
            class="inline-flex items-center justify-center rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Back to booking
          </a>
        </div>
      </main>
    );
  }

  const b: ConfirmedBooking = booking;
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
  const knownGuestTz = !!b.guestTz && isValidTimeZone(b.guestTz);
  const displayTz = canonicalTimeZoneOr(b.guestTz ?? undefined, b.hostTz);
  const dateLabel = formatHostDateIn(b.date, b.time, b.hostTz, displayTz);
  const timeLabel = formatHostClockIn(b.date, b.time, b.hostTz, displayTz);

  if (mode === "cancelled") {
    return (
      <main id={mainId} class={cancelledMainClass}>
        <div class="max-w-sm w-full">
          <div class="text-center mb-8">
            <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-surface-sunken text-ink-subtle mb-5">
              <Minus size={26} strokeWidth={1.8} />
            </div>
            <h1 class="text-2xl font-semibold tracking-(--tracking-tight) text-ink mb-2">
              Booking cancelled
            </h1>
            <p class="text-sm text-ink-muted tnum">
              {dateLabel} · {timeLabel}
            </p>
            {!knownGuestTz && (
              <p class="text-xs text-ink-subtle mt-1">
                Times are shown in the host's timezone.
              </p>
            )}
            <p class="text-sm text-ink-muted mt-4">
              Both you and {hostName} have been notified.
            </p>
          </div>
          <div class="text-center">
            <a
              href={backHref}
              class="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Book another time
              <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main id={mainId} class="flex-1 grid place-items-center px-4 sm:px-6 py-12">
      <div class="max-w-md w-full">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-300 mb-5">
            <Check />
          </div>
          <h1 class="text-2xl font-semibold tracking-(--tracking-tight) text-ink mb-2">
            You're booked
          </h1>
          <p class="text-sm text-ink-muted mt-2">
            A confirmation email is on its way to{" "}
            <span class="text-ink font-medium">{b.guestEmail}</span>.
          </p>
        </div>

        <div class="rounded-2xl border border-line bg-surface-raised divide-y divide-line">
          <Detail label="Date" value={<span class="tnum">{dateLabel}</span>} />
          <Detail label="Time" value={<span class="tnum">{timeLabel}</span>} />
          <Detail label="Duration" value={`${slotDurationMin} minutes`} />
          <Detail
            label="Meeting link"
            value={
              <a
                href={meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="text-brand-600 dark:text-brand-300 hover:underline break-all text-right"
              >
                {meetingUrl}
              </a>
            }
          />
        </div>

        {!knownGuestTz && (
          <p class="text-xs text-ink-subtle mt-3 text-center">
            Times are shown in the host's timezone.
          </p>
        )}

        <div class="mt-5 flex items-center justify-between gap-4 text-sm">
          <a
            href={backHref}
            class="inline-flex items-center gap-1 text-ink-muted hover:text-brand-600 dark:hover:text-brand-300 transition-colors focus:outline-none focus-visible:underline"
          >
            <ArrowLeft />
            Book another time
          </a>
          <a
            href={`/cancel?id=${b.id}&token=${b.cancelToken}`}
            target={cancelTarget}
            rel={cancelTarget ? "noopener noreferrer" : undefined}
            class="inline-flex items-center gap-1 text-ink-muted hover:text-red-600 dark:hover:text-red-300 transition-colors focus:outline-none focus-visible:underline"
          >
            Need to cancel?
            <ArrowRight />
          </a>
        </div>
      </div>
    </main>
  );
}

function Detail(
  { label, value }: { label: string; value: preact.ComponentChildren },
) {
  return (
    <div class="flex items-center justify-between gap-4 px-5 py-3.5">
      <span class="text-sm text-ink-muted">{label}</span>
      <span class="text-sm text-ink">{value}</span>
    </div>
  );
}
