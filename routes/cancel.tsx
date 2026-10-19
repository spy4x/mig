import { Button } from "@spy4x/preact-ui/button"
import { Card, CardBody } from "@spy4x/preact-ui/card"
import { Field } from "@spy4x/preact-ui/field"
import { Textarea } from "@spy4x/preact-ui/input"
import { define } from "../lib/utils.ts"
import { NOTES_MAX_LENGTH } from "../lib/validators.ts"
import { cancelTokenHolder } from "../lib/cancel-token.ts"
import { Header } from "../components/Header.tsx"
import { Footer } from "../components/Footer.tsx"
import { canonicalTimeZoneOr, isValidTimeZone } from "@spy4x/time/tz"
import {
  formatClockShortAt,
  formatHostClockIn,
  formatHostDateIn,
} from "../lib/clock.ts"
import { IconInformationCircle } from "@spy4x/preact-icons"

interface CancelData {
  state: "ok" | "missing" | "invalid" | "not-found" | "already-cancelled"
  booking:
    | {
      id: string
      date: string
      time: string
      hostTz: string
      guestTz: string | null
      guestName: string
    }
    | null
  token: string | null
  cancelledAt: string | null
  // Needed to format `cancelledAt` in the right zone for the
  // "already-cancelled" state, which otherwise carries no booking
  // (mig#15 round 2 — this used to fall back to
  // `Date.toLocaleString()`, which reads the *server process's* zone,
  // not the visitor's or the host's).
  hostTz: string | null
  guestTz: string | null
}

export const handler = define.handlers({
  async GET(ctx) {
    const cfg = ctx.state.config
    const url = new URL(ctx.req.url)
    const id = url.searchParams.get("id") ?? ""
    const token = url.searchParams.get("token") ?? ""

    if (!id || !token) {
      return {
        data: {
          state: "missing",
          booking: null,
          token: null,
          cancelledAt: null,
          hostTz: null,
          guestTz: null,
        } satisfies CancelData,
      }
    }

    const booking = ctx.state.bookings.get(id)
    if (!booking) {
      return {
        data: {
          state: "not-found",
          booking: null,
          token: null,
          cancelledAt: null,
          hostTz: null,
          guestTz: null,
        } satisfies CancelData,
      }
    }

    const ok = await cancelTokenHolder(booking, token, cfg.cancelSecret) !==
      null
    if (!ok) {
      return {
        data: {
          state: "invalid",
          booking: null,
          token: null,
          cancelledAt: null,
          hostTz: null,
          guestTz: null,
        } satisfies CancelData,
      }
    }

    if (booking.status === "cancelled") {
      return {
        data: {
          state: "already-cancelled",
          booking: null,
          token: null,
          cancelledAt: booking.cancelledAt ?? null,
          hostTz: booking.hostTz,
          guestTz: booking.guestTz ?? null,
        } satisfies CancelData,
      }
    }

    return {
      data: {
        state: "ok",
        booking: {
          id: booking.id,
          date: booking.date,
          time: booking.time,
          hostTz: booking.hostTz,
          guestTz: booking.guestTz ?? null,
          guestName: booking.guestName,
        },
        token,
        cancelledAt: null,
        hostTz: booking.hostTz,
        guestTz: booking.guestTz ?? null,
      } satisfies CancelData,
    }
  },
})

export default define.page<typeof handler>(function Cancel({ data, state }) {
  const cfg = state.config
  const errStates: Array<typeof data.state> = [
    "missing",
    "invalid",
    "not-found",
    "already-cancelled",
  ]

  if (errStates.includes(data.state)) {
    // "Already cancelled" needs the cancellation instant formatted in
    // the visitor's zone when known, else the host's — never
    // `Date.toLocaleString()`, which reads the *server process's own*
    // zone (mig#15 round 2), unrelated to either party's.
    const cancelKnownGuestTz = !!data.guestTz && isValidTimeZone(data.guestTz)
    const cancelDisplayTz = data.hostTz
      ? canonicalTimeZoneOr(data.guestTz ?? undefined, data.hostTz)
      : null
    const cancelledAtLabel = data.cancelledAt && cancelDisplayTz
      ? formatClockShortAt(new Date(data.cancelledAt), cancelDisplayTz)
      : null

    const messages: Record<typeof data.state, { title: string; body: string }> =
      {
        ok: { title: "", body: "" },
        missing: {
          title: "Missing parameters",
          body: "The cancellation link is malformed.",
        },
        invalid: {
          title: "This cancellation link is invalid or has expired",
          body:
            "If you got here from an email, the link may have been tampered with.",
        },
        "not-found": {
          title: "This booking no longer exists",
          body: "It may have been cancelled already or never existed.",
        },
        "already-cancelled": {
          title: "Already cancelled",
          body: cancelledAtLabel
            ? `This booking was cancelled on ${cancelledAtLabel}.`
            : "This booking was cancelled on an earlier date.",
        },
      }
    const msg = messages[data.state]
    const showCancelTzNote = data.state === "already-cancelled" &&
      cancelledAtLabel && !cancelKnownGuestTz
    return (
      <div class="min-h-dvh flex flex-col">
        <Header defaultTheme={cfg.theme} />
        <main class="flex-1 px-4 py-12 sm:px-6">
          <div class="mx-auto w-full max-w-md text-center">
            <div class="mb-4 inline-flex size-12 items-center justify-center rounded-full border border-subtle bg-surface text-muted">
              <IconInformationCircle class="size-6" />
            </div>
            <h1 class="text-2xl font-semibold tracking-tight text-balance text-foreground">
              {msg.title}
            </h1>
            <p class="mt-2 text-sm text-pretty text-muted">{msg.body}</p>
            {showCancelTzNote && (
              <p class="mt-1 text-sm text-muted">
                Times are shown in the host's timezone.
              </p>
            )}
            <div class="mt-6">
              <Button href="/" class="min-h-11 sm:min-h-9">
                Book a time
              </Button>
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
  }

  const b = data.booking!
  const token = data.token!
  // Render the booking time in the visitor's TZ when we captured one
  // at submit time — same convention as the /confirmed page. Falls
  // back to host TZ for older bookings without guestTz, or for
  // invalid values. Both helpers need `b.hostTz` (the zone `b.date`/
  // `b.time` are actually stored in) as well as `displayTz` — see
  // lib/clock.ts, mig#15.
  const knownGuestTz = !!b.guestTz && isValidTimeZone(b.guestTz)
  const displayTz = canonicalTimeZoneOr(b.guestTz ?? undefined, b.hostTz)
  const whenDate = formatHostDateIn(b.date, b.time, b.hostTz, displayTz)
  const whenTime = formatHostClockIn(b.date, b.time, b.hostTz, displayTz)

  return (
    <div class="min-h-dvh flex flex-col">
      <Header defaultTheme={cfg.theme} />
      <main class="flex-1 px-4 py-12 sm:px-6">
        <div class="mx-auto w-full max-w-md">
          <Card>
            <div class="border-b border-subtle px-4 py-4 sm:px-6">
              <h1 class="text-xl font-semibold tracking-tight text-foreground">
                Cancel your booking?
              </h1>
              <p class="mt-2 text-sm text-foreground tabular-nums">
                {whenDate}
              </p>
              <p class="text-sm text-foreground tabular-nums">{whenTime}</p>
              <p class="mt-1 text-sm text-muted">with {cfg.hostName}</p>
              {!knownGuestTz && (
                <p class="mt-1 text-sm text-muted">
                  Times are shown in the host's timezone.
                </p>
              )}
            </div>

            <CardBody>
              <form method="POST" action="/api/cancel" class="space-y-4">
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="token" value={token} />

                <Field id="reason" label="Reason" hint="Optional">
                  <Textarea
                    name="reason"
                    rows={3}
                    maxLength={NOTES_MAX_LENGTH}
                    placeholder="Let the other person know why."
                    class="resize-y"
                  />
                </Field>

                <p class="text-sm text-muted">
                  We'll let {cfg.hostName} know, and email you both.
                </p>

                <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    href={`/confirmed?id=${encodeURIComponent(b.id)}&token=${
                      encodeURIComponent(token)
                    }`}
                    variant="ghost"
                    class="min-h-11 sm:min-h-9"
                  >
                    Keep booking
                  </Button>
                  <Button
                    type="submit"
                    variant="danger"
                    class="min-h-11 sm:min-h-9"
                  >
                    Cancel booking
                  </Button>
                </div>
              </form>
            </CardBody>
          </Card>
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
