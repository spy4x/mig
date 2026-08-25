import { define } from "../lib/utils.ts";
import { verifyCancelToken } from "../lib/tokens.ts";

interface ConfirmedData {
  state: "ok" | "missing" | "invalid" | "expired";
  booking:
    | {
      id: string;
      date: string;
      time: string;
      hostTz: string;
      guestName: string;
      guestEmail: string;
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
        data: { state: "missing", booking: null } satisfies ConfirmedData,
      };
    }

    const booking = ctx.state.bookings.get(id);
    if (!booking) {
      return {
        data: { state: "expired", booking: null } satisfies ConfirmedData,
      };
    }

    const ok = await verifyCancelToken(
      token,
      booking.cancelTokenHash,
      cfg.cancelSecret,
    );
    if (!ok) {
      return {
        data: { state: "invalid", booking: null } satisfies ConfirmedData,
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
          guestName: booking.guestName,
          guestEmail: booking.guestEmail,
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
  const dt = new Date(b.date + "T" + b.time + ":00Z");
  const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    dt.getUTCDay()
  ];
  const monthShort = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][dt.getUTCMonth()];
  const when =
    `${dayName} ${dt.getUTCDate()} ${monthShort} ${dt.getUTCFullYear()}, ${b.time} (${b.hostTz})`;

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
          <p class="text-slate-300">{when}</p>
          <p class="text-slate-500 text-sm mt-2">
            A confirmation email is on its way to {b.guestEmail}.
          </p>
        </div>

        <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-6 space-y-4">
          <div>
            <div class="text-xs uppercase tracking-wider text-slate-500 mb-1">
              Meeting link
            </div>
            <a
              href={cfg.meetingUrl}
              class="text-orange-500 hover:text-orange-400 break-all text-sm"
            >
              {cfg.meetingUrl}
            </a>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wider text-slate-500 mb-1">
              Duration
            </div>
            <div class="text-slate-200 text-sm">
              {cfg.slotDurationMin} minutes
            </div>
          </div>
        </div>

        <div class="text-center mt-8">
          <a
            href="/"
            class="text-orange-500 hover:text-orange-400 text-sm font-medium"
          >
            Book another time →
          </a>
        </div>
      </div>
    </main>
  );
});
