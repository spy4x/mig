import { define } from "../lib/utils.ts";
import { verifyCancelToken } from "../lib/tokens.ts";

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
    const wasCancelled = url.searchParams.get("cancelled") === "1";

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

export default define.page<typeof handler>(function Confirmed({ data, state }) {
  const cfg = state.config;

  if (data.state !== "ok" || !data.booking) {
    return (
      <main class="min-h-screen flex items-center justify-center p-6">
        <div class="text-center max-w-md">
          <h1 class="text-2xl font-semibold text-slate-100 mb-2">
            {data.state === "invalid"
              ? "Invalid or expired link"
              : data.state === "missing"
              ? "Link missing parameters"
              : "Booking not found"}
          </h1>
          <p class="text-slate-400 mb-6">
            {data.state === "invalid"
              ? "The link you used has been tampered with or is no longer valid."
              : "Check the URL and try again, or contact the host."}
          </p>
          <a
            href="/"
            class="inline-block px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium transition-colors"
          >
            Back to booking
          </a>
        </div>
      </main>
    );
  }

  const b = data.booking;
  // "Thursday, 28 August 2026, 10:00" in the host's timezone.
  const dt = new Date(b.date + "T" + b.time + ":00Z");
  const dayName = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][dt.getUTCDay()];
  const monthName = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ][
    dt.getUTCMonth()
  ];
  const when =
    `${dayName}, ${dt.getUTCDate()} ${monthName} ${dt.getUTCFullYear()}, ${b.time}`;
  const tzLine = b.hostTz;

  if (data.mode === "cancelled") {
    return (
      <main class="min-h-screen flex items-center justify-center p-6">
        <div class="max-w-md w-full text-center">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-700/50 mb-4">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#94a3b8"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14" />
            </svg>
          </div>
          <h1 class="text-3xl font-semibold text-slate-100 mb-2">Cancelled</h1>
          <p class="text-slate-300">
            {when} <span class="text-slate-500">({tzLine})</span>
          </p>
          <p class="text-slate-500 text-sm mt-2">
            The booking has been cancelled. Both you and {cfg.hostName}{" "}
            have been notified.
          </p>

          <div class="text-center mt-8">
            <a
              href="/"
              class="text-orange-500 hover:text-orange-400 text-sm font-medium"
            >
              ← Book another time
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main class="min-h-screen flex items-center justify-center p-6">
      <div class="max-w-md w-full">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-orange-500/10 mb-4">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#f97316"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h1 class="text-3xl font-semibold text-slate-100 mb-2">Booked!</h1>
          <p class="text-slate-300">
            {when} <span class="text-slate-500">({tzLine})</span>
          </p>
          <p class="text-slate-500 text-sm mt-2">
            A confirmation email is on its way to {b.guestEmail}.
          </p>
        </div>

        <div class="border-t border-slate-700 my-6"></div>

        <div>
          <h2 class="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-4">
            Meeting details
          </h2>
          <div class="space-y-3 text-sm">
            <div class="flex items-baseline justify-between gap-4">
              <span class="text-slate-500">Duration</span>
              <span class="text-slate-200 text-right">
                {cfg.slotDurationMin} minutes
              </span>
            </div>
            <div class="flex items-baseline justify-between gap-4">
              <span class="text-slate-500">Meeting link</span>
              <a
                href={cfg.meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="text-orange-500 hover:text-orange-400 break-all text-right"
              >
                {cfg.meetingUrl}
              </a>
            </div>
            <div class="flex items-baseline justify-between gap-4">
              <span class="text-slate-500">Your timezone</span>
              <span class="text-slate-200 text-right">
                {tzLine}
                <span class="block text-xs text-slate-500 mt-0.5">
                  Detected from your browser.
                </span>
              </span>
            </div>
          </div>
        </div>

        <div class="border-t border-slate-700 my-6"></div>

        <div>
          <h2 class="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-3">
            Need to cancel?
          </h2>
          <a
            href={`/cancel?id=${b.id}&token=${b.cancelToken}`}
            class="inline-block px-5 py-2.5 rounded-lg border border-red-500/50 text-red-300 hover:bg-red-500/10 hover:border-red-500 font-medium transition-colors"
          >
            Cancel this booking
          </a>
        </div>

        <div class="text-center mt-8">
          <a
            href="/"
            class="text-orange-500 hover:text-orange-400 text-sm font-medium"
          >
            ← Book another time
          </a>
        </div>
      </div>
    </main>
  );
});
