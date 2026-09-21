// Shared GET handler logic for /confirmed and /embed/confirmed.
// Both routes look up the same booking by `id` + `token`; keeping the
// lookup in one place means the two pages can never drift on what
// counts as "missing" / "invalid" / "expired" / "ok".

import type { Context } from "fresh";
import type { State } from "./utils.ts";
import { verifyCancelToken } from "./tokens.ts";

export interface ConfirmedBooking {
  id: string;
  date: string;
  time: string;
  hostTz: string;
  guestTz: string | null;
  guestName: string;
  guestEmail: string;
  cancelToken: string;
}

export interface ConfirmedData {
  state: "ok" | "missing" | "invalid" | "expired";
  mode: "booked" | "cancelled";
  booking: ConfirmedBooking | null;
}

export async function loadConfirmedData(
  ctx: Context<State>,
): Promise<ConfirmedData> {
  const cfg = ctx.state.config;
  const url = new URL(ctx.req.url);
  const id = url.searchParams.get("id") ?? "";
  const token = url.searchParams.get("token") ?? "";

  if (!id || !token) {
    return { state: "missing", mode: "booked", booking: null };
  }

  const booking = ctx.state.bookings.get(id);
  if (!booking) {
    return { state: "expired", mode: "booked", booking: null };
  }

  const ok = await verifyCancelToken(
    token,
    booking.cancelTokenHash,
    cfg.cancelSecret,
  );
  if (!ok) {
    return { state: "invalid", mode: "booked", booking: null };
  }

  // ?cancelled=1 → cancellation success page. The actual source of
  // truth is the booking status: a cancelled booking should always
  // show the cancelled view, whether the user landed here via
  // /api/cancel's redirect (with ?cancelled=1) or via a bookmark
  // (without). A booked URL pointing at a now-cancelled booking
  // shouldn't lie and show "Booked!" again.
  const mode = booking.status === "cancelled" ? "cancelled" : "booked";

  return {
    state: "ok",
    mode,
    booking: {
      id: booking.id,
      date: booking.date,
      time: booking.time,
      hostTz: booking.hostTz,
      guestTz: booking.guestTz ?? null,
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      cancelToken: token,
    },
  };
}
