// Shared POST /api/book and POST /embed/book handler logic.
//
// Both routes call `handleBookingSubmit` with the base path they were
// hit on ("" for /api/book, "/embed" for /embed/book). `basePath` is
// always a compile-time constant the route file passes — never taken
// from the request — so a booking started under /embed can only ever
// redirect back under /embed, and a standalone booking only under "/".
// That's what keeps a host's `frame-ancestors` allow-list scoped to
// /embed meaningful (issue #11).

import type { Context } from "fresh";
import type { State } from "./utils.ts";
import { generateBookingId, newCancelToken } from "./tokens.ts";
import { sendBookingEmails } from "./email.ts";
import { notifyBookingEmailFailed, notifyBookingSucceeded } from "./notify.ts";
import { clientIp, humanRetry } from "./ratelimit.ts";
import { zonedDateTime } from "./tz.ts";
import { BookingSchema } from "./validators.ts";

/** "" → "/", "/embed" → "/embed" — where a failed submission redirects
 *  back to (the picker root). */
function formPath(basePath: string): string {
  return basePath === "" ? "/" : basePath;
}

export async function handleBookingSubmit(
  ctx: Context<State>,
  basePath: string,
): Promise<Response> {
  const cfg = ctx.state.config;
  const ip = clientIp(ctx.req);

  function errRedirect(
    message: string,
    state?: { date?: string; slot?: string; tz?: string },
  ): Response {
    const params = new URLSearchParams({ err: message });
    if (state?.date) params.set("date", state.date);
    if (state?.slot) params.set("slot", state.slot);
    if (state?.tz) params.set("tz", state.tz);
    return Response.redirect(
      new URL(`${formPath(basePath)}?${params.toString()}`, cfg.publicUrl)
        .toString(),
      303,
    );
  }

  // Rate limit per IP
  const limit = ctx.state.rateLimiter.check(ip);
  if (!limit.ok) {
    return errRedirect(
      `Too many attempts. Try again in ${humanRetry(limit.retryAfterMs)}.`,
    );
  }

  const form = await ctx.req.formData();
  // Raw, unvalidated — used only to carry state back on a failed
  // redirect (mig#15 review). `date` and `tz` always ride along: the
  // route re-validates both on the way back in, so passing the raw
  // values through here never bypasses that. `slot` only comes along
  // for a failure that leaves the slot itself still meaningful to
  // retry (bad form input, or the confirmation email failing to send
  // — the slot is still free either way); every other failure means
  // the slot itself is gone or was never valid, so keeping it would
  // land the visitor back on the confirm step for a slot they can't
  // actually book, and resubmitting would send another false
  // confirmation (mig#15 round 2 — see each call site below).
  const redirectDateTz = {
    date: String(form.get("date") || "") || undefined,
    tz: String(form.get("guestTz") || "") || undefined,
  };
  const redirectState = {
    ...redirectDateTz,
    slot: String(form.get("slot") || "") || undefined,
  };
  const parsed = BookingSchema.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    notes: form.get("notes") ?? "",
    date: form.get("date"),
    slot: form.get("slot"),
    guestTz: form.get("guestTz") || undefined,
    website: form.get("website") ?? "",
  });
  if (!parsed.success) {
    return errRedirect(
      parsed.error.issues[0]?.message ?? "Invalid form data.",
      redirectState,
    );
  }
  const input = parsed.data;

  // Honeypot — silently accept and pretend to succeed (no booking).
  if (input.website.trim() !== "") {
    // Redirect to confirmed with a fake id; no email sent, no booking created.
    // Bots think they succeeded and go away.
    return Response.redirect(
      new URL(
        `${basePath}/confirmed?id=fake&token=fake`,
        cfg.publicUrl,
      ).toString(),
      303,
    );
  }

  // Sanity: slot must be within availability, not booked, not in the past.
  // This and every other availability/conflict/persist failure below
  // drops `slot` — it's no longer a valid pick, so keeping it would
  // land the visitor back on the confirm step for a slot they can't
  // book (mig#15 round 2).
  const minStart = new Date(Date.now() + cfg.minNoticeHours * 3600_000);
  const slotInstant = zonedDateTime(input.date, input.slot, cfg.hostTz);
  if (slotInstant < minStart) {
    return errRedirect("That time is no longer available.", redirectDateTz);
  }

  // Check slot is in availability
  const dayName = (() => {
    const dt = zonedDateTime(input.date, "12:00", cfg.hostTz);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.hostTz,
      weekday: "short",
    }).format(dt).toUpperCase();
  })();
  const ranges =
    cfg.weeklyAvailability[dayName as keyof typeof cfg.weeklyAvailability];
  const slotMin = parseInt(input.slot.slice(0, 2), 10) * 60 +
    parseInt(input.slot.slice(3), 10);
  const inAvail = ranges.some((r) =>
    slotMin >= r.startMin && slotMin + cfg.slotDurationMin <= r.endMin
  );
  if (!inAvail) {
    return errRedirect(
      "That time is outside availability hours.",
      redirectDateTz,
    );
  }

  // Blocked date?
  if (cfg.blockedDates.has(input.date)) {
    return errRedirect(
      "That date is not available for booking.",
      redirectDateTz,
    );
  }

  // Transactional booking flow: email first, then persist. If the
  // email send fails, the booking is NOT created — we don't want a
  // booking record without a corresponding email because the cancel
  // link in the email is the only out-of-band cancellation path
  // the guest has. If the persist fails after the email went out,
  // we have a partial state (the guest has the email but the row
  // isn't on disk) — log loudly and surface a real error to the
  // user so they can contact the host directly.
  const { raw: tokenRaw, hash: tokenHash } = await newCancelToken(
    cfg.cancelSecret,
  );
  const bookingId = generateBookingId();
  const booking = {
    id: bookingId,
    createdAt: new Date().toISOString(),
    date: input.date,
    time: input.slot,
    hostTz: cfg.hostTz,
    guestTz: input.guestTz,
    guestName: input.name.trim(),
    guestEmail: input.email.trim().toLowerCase(),
    notes: input.notes.trim() || undefined,
    cancelTokenHash: tokenHash,
    status: "active" as const,
  };

  // Phase 1: send the email first.
  try {
    const cancelUrl = new URL(
      `/cancel?id=${bookingId}&token=${tokenRaw}`,
      cfg.publicUrl,
    ).toString();
    await sendBookingEmails(cfg, booking, cancelUrl);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("mig: email send failed; booking NOT created:", msg);
    // Optional NTFY push so the host gets a heads-up outside the
    // email channel. Fire-and-forget — we don't await the NTFY
    // response before redirecting the user, so a slow NTFY won't
    // add latency to the page.
    await notifyBookingEmailFailed(cfg, booking, msg);
    return errRedirect(
      "We couldn't send your confirmation email, so the booking was not created. Please try again in a moment.",
      redirectState,
    );
  }

  // Phase 2: persist under the mutex. Re-check the conflict because
  // a concurrent request could have taken the slot in the few
  // milliseconds between Phase 1 and Phase 2.
  try {
    const result = await ctx.state.bookings.mutate((draft) => {
      const conflict = draft.find(
        (b) =>
          b.status === "active" &&
          b.date === input.date &&
          b.time === input.slot,
      );
      if (conflict) {
        return { ok: false as const };
      }
      draft.push(booking);
      return { ok: true as const };
    });
    if (!result.ok) {
      // Someone else booked the slot between our email send and our
      // persist. The email we already sent is now stale. Fail
      // loudly so the host can reach out and reschedule.
      console.error(
        "mig: slot taken after email sent; booking=" + bookingId,
      );
      return errRedirect(
        "That time was just booked by someone else. The confirmation email you received is no longer valid — please pick another time.",
        redirectDateTz,
      );
    }
  } catch (e) {
    // Persist failed after the email already went out. The guest
    // has a confirmation but no cancel link will work. Log loudly
    // so the host can manually add the booking or reach out.
    console.error(
      "mig: persist FAILED after email sent; booking=" + bookingId,
      e,
    );
    return errRedirect(
      "Your confirmation was sent, but we couldn't save the booking on our end. Please contact the host directly to confirm.",
      redirectDateTz,
    );
  }

  // Booking persisted and email sent — fire the success notification
  // (subject to NTFY_MODE in lib/notify.ts).
  await notifyBookingSucceeded(cfg, booking);

  return Response.redirect(
    new URL(
      `${basePath}/confirmed?id=${bookingId}&token=${tokenRaw}`,
      cfg.publicUrl,
    ).toString(),
    303,
  );
}
