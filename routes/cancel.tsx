import { define } from "../lib/utils.ts";
import { verifyCancelToken } from "../lib/tokens.ts";

interface CancelData {
  state: "ok" | "missing" | "invalid" | "not-found" | "already-cancelled";
  booking:
    | {
      id: string;
      date: string;
      time: string;
      hostTz: string;
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
          body: `This booking was cancelled on ${
            data.cancelledAt
              ? new Date(data.cancelledAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })
              : "an earlier date"
          }.`,
        },
      };
    const msg = messages[data.state];
    return (
      <main class="min-h-screen flex items-center justify-center p-6">
        <div class="max-w-md w-full text-center">
          <h1 class="text-2xl font-semibold text-slate-100 mb-2">
            {msg.title}
          </h1>
          <p class="text-slate-400 mb-6">{msg.body}</p>
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

  const b = data.booking!;
  const token = data.token!;
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
      <div class="max-w-md w-full bg-slate-800/50 border border-slate-700 rounded-xl p-8">
        <h1 class="text-2xl font-semibold text-slate-100 mb-2">
          Cancel your booking?
        </h1>
        <p class="text-slate-300 mb-1">{when}</p>
        <p class="text-slate-500 text-sm mb-6">with {cfg.hostName}</p>

        <form method="POST" action="/api/cancel" class="space-y-4">
          <input type="hidden" name="id" value={b.id} />
          <input type="hidden" name="token" value={token} />
          <div>
            <label
              for="reason"
              class="block text-sm font-medium text-slate-300 mb-1.5"
            >
              Reason <span class="text-slate-500 font-normal">(optional)</span>
            </label>
            <textarea
              id="reason"
              name="reason"
              rows={3}
              maxLength={500}
              placeholder="Let the other person know why (optional)."
              class="w-full px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors resize-y"
            />
          </div>

          <div class="flex items-center justify-end gap-3 pt-2">
            <a
              href="/"
              class="px-5 py-2.5 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors font-medium"
            >
              Keep booking
            </a>
            <button
              type="submit"
              class="px-5 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              Cancel booking
            </button>
          </div>
        </form>
      </div>
    </main>
  );
});
