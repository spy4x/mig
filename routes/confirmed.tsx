import { define } from "../lib/utils.ts";
import { verifyCancelToken } from "../lib/tokens.ts";
import { Header } from "../components/Header.tsx";
import { Footer } from "../components/Footer.tsx";

interface ConfirmedData {
  state: "ok" | "missing" | "invalid" | "expired";
  mode: "booked" | "cancelled";
  booking:
    | {
      id: string;
      date: string;
      time: string;
      hostTz: string;
      guestName: string;
      guestEmail: string;
      cancelToken: string;
    }
    | null;
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
          mode: "booked",
          booking: null,
        } satisfies ConfirmedData,
      };
    }

    const booking = ctx.state.bookings.get(id);
    if (!booking) {
      return {
        data: {
          state: "expired",
          mode: "booked",
          booking: null,
        } satisfies ConfirmedData,
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
          mode: "booked",
          booking: null,
        } satisfies ConfirmedData,
      };
    }

    // ?cancelled=1 → cancellation success page. The actual source of
    // truth is the booking status: a cancelled booking should always
    // show the cancelled view, whether the user landed here via
    // /api/cancel's redirect (with ?cancelled=1) or via a bookmark
    // (without). A booked URL pointing at a now-cancelled booking
    // shouldn't lie and show "Booked!" again.
    const mode = booking.status === "cancelled" ? "cancelled" : "booked";

    return {
      data: {
        state: "ok",
        mode,
        booking: {
          id: booking.id,
          date: booking.date,
          time: booking.time,
          hostTz: booking.hostTz,
          guestName: booking.guestName,
          guestEmail: booking.guestEmail,
          cancelToken: token,
        },
      } satisfies ConfirmedData,
    };
  },
});

// Date-only format used on the success page — no tz label leaks.
// The ICS attachment carries the precise UTC instant so any
// calendar client can place it in the visitor's local zone.
function formatWhenShort(date: string, time: string, tz: string): string {
  const dt = new Date(date + "T" + time + ":00Z");
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dt);
}

export default define.page<typeof handler>(function Confirmed({ data, state }) {
  const cfg = state.config;

  if (data.state !== "ok" || !data.booking) {
    const title = data.state === "invalid"
      ? "Invalid or expired link"
      : data.state === "missing"
      ? "Link missing parameters"
      : "Booking not found";
    const body = data.state === "invalid"
      ? "The link you used has been tampered with or is no longer valid."
      : "Check the URL and try again, or contact the host.";
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
              {title}
            </h1>
            <p class="text-sm text-ink-muted mb-6">{body}</p>
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

  const b = data.booking;
  const when = formatWhenShort(b.date, b.time, b.hostTz);

  if (data.mode === "cancelled") {
    return (
      <div class="min-h-dvh flex flex-col">
        <Header compact />
        <main class="flex-1 grid place-items-center px-6 py-16">
          <div class="max-w-sm w-full">
            <div class="text-center mb-8">
              <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-surface-sunken text-ink-subtle mb-5">
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14" />
                </svg>
              </div>
              <h1 class="text-2xl font-semibold tracking-(--tracking-tight) text-ink mb-2">
                Booking cancelled
              </h1>
              <p class="text-sm text-ink-muted tnum">{when}</p>
              <p class="text-sm text-ink-muted mt-4">
                Both you and {cfg.hostName} have been notified.
              </p>
            </div>
            <div class="text-center">
              <a
                href="/"
                class="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Book another time
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </a>
            </div>
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

  return (
    <div class="min-h-dvh flex flex-col">
      <Header compact />
      <main class="flex-1 grid place-items-center px-4 sm:px-6 py-12">
        <div class="max-w-md w-full">
          <div class="text-center mb-8">
            <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-brand-500/15 text-brand-600 dark:text-brand-300 mb-5">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h1 class="text-2xl font-semibold tracking-(--tracking-tight) text-ink mb-2">
              You're booked
            </h1>
            <p class="text-sm text-ink-muted tnum">{when}</p>
            <p class="text-sm text-ink-muted mt-4">
              A confirmation email is on its way to{" "}
              <span class="text-ink font-medium">{b.guestEmail}</span>.
            </p>
          </div>

          <div class="rounded-2xl border border-line bg-surface-raised divide-y divide-line">
            <Detail label="Duration" value={`${cfg.slotDurationMin} minutes`} />
            <Detail
              label="Meeting link"
              value={
                <a
                  href={cfg.meetingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-brand-600 dark:text-brand-300 hover:underline break-all text-right"
                >
                  {cfg.meetingUrl}
                </a>
              }
            />
          </div>

          <div class="mt-6 text-center">
            <a
              href={`/cancel?id=${b.id}&token=${b.cancelToken}`}
              class="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-red-600 dark:hover:text-red-300 transition-colors focus:outline-none focus-visible:underline"
            >
              Need to cancel?
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </a>
          </div>

          <div class="mt-8 text-center">
            <a
              href="/"
              class="text-sm font-medium text-brand-600 dark:text-brand-300 hover:underline"
            >
              ← Book another time
            </a>
          </div>
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
