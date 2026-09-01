import { define } from "../lib/utils.ts";
import { verifyCancelToken } from "../lib/tokens.ts";
import { Header } from "../components/Header.tsx";
import { Footer } from "../components/Footer.tsx";
import { formatDateLong, formatTimeOfDay, validTimeZoneOr } from "../lib/tz.ts";

interface CancelData {
  state: "ok" | "missing" | "invalid" | "not-found" | "already-cancelled";
  booking:
    | {
      id: string;
      date: string;
      time: string;
      hostTz: string;
      guestTz: string | null;
      guestName: string;
    }
    | null;
  token: string | null;
  cancelledAt: string | null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const cfg = ctx.state.config;
    const url = new URL(ctx.req.url);
    const id = url.searchParams.get("id") ?? "";
    const token = url.searchParams.get("token") ?? "";

    if (!id || !token) {
      return {
        data: {
          state: "missing",
          booking: null,
          token: null,
          cancelledAt: null,
        } satisfies CancelData,
      };
    }

    const booking = ctx.state.bookings.get(id);
    if (!booking) {
      return {
        data: {
          state: "not-found",
          booking: null,
          token: null,
          cancelledAt: null,
        } satisfies CancelData,
      };
    }

    const ok = await verifyCancelToken(
      token,
      booking.cancelTokenHash,
      cfg.cancelSecret,
    );
    if (!ok) {
      return {
        data: {
          state: "invalid",
          booking: null,
          token: null,
          cancelledAt: null,
        } satisfies CancelData,
      };
    }

    if (booking.status === "cancelled") {
      return {
        data: {
          state: "already-cancelled",
          booking: null,
          token: null,
          cancelledAt: booking.cancelledAt ?? null,
        } satisfies CancelData,
      };
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
      } satisfies CancelData,
    };
  },
});

export default define.page<typeof handler>(function Cancel({ data, state }) {
  const cfg = state.config;
  const errStates: Array<typeof data.state> = [
    "missing",
    "invalid",
    "not-found",
    "already-cancelled",
  ];

  if (errStates.includes(data.state)) {
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
          body: data.cancelledAt
            ? `This booking was cancelled on ${
              new Date(data.cancelledAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })
            }.`
            : "This booking was cancelled on an earlier date.",
        },
      };
    const msg = messages[data.state];
    return (
      <div class="min-h-dvh flex flex-col">
        <Header compact />
        <main class="flex-1 grid place-items-center px-6 py-16">
          <div class="max-w-sm text-center">
            <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-surface-sunken text-ink-subtle mb-4">
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h1 class="text-xl font-semibold tracking-(--tracking-tight) text-ink mb-2">
              {msg.title}
            </h1>
            <p class="text-sm text-ink-muted mb-6">{msg.body}</p>
            <a
              href="/"
              class="inline-flex items-center justify-center rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Back to booking
            </a>
          </div>
        </main>
        <Footer
          githubUrl={cfg.githubUrl}
          hidden={cfg.hideBranding}
          version={cfg.version}
        />
      </div>
    );
  }

  const b = data.booking!;
  const token = data.token!;
  // Render the booking time in the visitor's TZ when we captured one
  // at submit time — same convention as the /confirmed page. Falls
  // back to host TZ for older bookings without guestTz, or for
  // invalid values.
  const displayTz = validTimeZoneOr(b.guestTz ?? undefined, b.hostTz);
  const whenDate = formatDateLong(b.date, displayTz);
  const whenTime = formatTimeOfDay(b.date, b.time, displayTz);

  return (
    <div class="min-h-dvh flex flex-col">
      <Header compact />
      <main class="flex-1 grid place-items-center px-4 sm:px-6 py-12">
        <div class="max-w-md w-full">
          <div class="rounded-2xl border border-line bg-surface-raised overflow-hidden">
            <div class="px-6 pt-6 pb-5 border-b border-line">
              <h1 class="text-xl font-semibold tracking-(--tracking-tight) text-ink mb-2">
                Cancel your booking?
              </h1>
              <p class="text-sm text-ink-muted tnum">{whenDate}</p>
              <p class="text-sm text-ink tnum">{whenTime}</p>
              <p class="text-xs text-ink-subtle mt-1">
                with {cfg.hostName}
              </p>
            </div>

            <form
              method="POST"
              action="/api/cancel"
              class="px-6 py-5 space-y-4"
            >
              <input type="hidden" name="id" value={b.id} />
              <input type="hidden" name="token" value={token} />

              <div>
                <label
                  for="reason"
                  class="block text-sm font-medium text-ink mb-1.5"
                >
                  Reason
                  <span class="text-ink-subtle font-normal ml-1">
                    (optional)
                  </span>
                </label>
                <textarea
                  id="reason"
                  name="reason"
                  rows={3}
                  maxLength={500}
                  placeholder="Let the other person know why (optional)."
                  class="block w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle/70 transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 resize-y"
                />
              </div>

              <div class="flex items-center justify-end pt-2">
                <button
                  type="submit"
                  class="inline-flex items-center justify-center gap-2 rounded-lg bg-red-500 hover:bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>

          <p class="text-xs text-ink-subtle text-center mt-4">
            This will notify both you and {cfg.hostName}.
          </p>
        </div>
      </main>
      <Footer
        githubUrl={cfg.githubUrl}
        hidden={cfg.hideBranding}
        version={cfg.version}
      />
    </div>
  );
});
