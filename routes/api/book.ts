// POST /api/book — create a booking. Form fields:
//   name, email, notes (optional), date, slot, website (honeypot)
//
// On success: 303 redirect to /confirmed?id=...&token=...
// On failure: 303 redirect to /?err=...

import { define } from "../../lib/utils.ts";
import { newCancelToken } from "../../lib/tokens.ts";
import { sendBookingEmails } from "../../lib/email.ts";
import { notifyBookingEmailFailed } from "../../lib/notify.ts";
import { clientIp, humanRetry } from "../../lib/ratelimit.ts";
import { zonedDateTime } from "../../lib/tz.ts";
import { BookingSchema } from "./_validators.ts";

function errRedirect(
  cfg: { publicUrl: string },
  message: string,
  date?: string,
): Response {
  const params = new URLSearchParams({ err: message });
  if (date) params.set("date", date);
  return Response.redirect(
    new URL(`/?${params.toString()}`, cfg.publicUrl).toString(),
    303,
  );
}

export const handler = define.handlers({
  async POST(ctx) {
    const cfg = ctx.state.config;
    const ip = clientIp(ctx.req);

    // Rate limit per IP
    const limit = ctx.state.rateLimiter.check(ip);
    if (!limit.ok) {
      return errRedirect(
        cfg,
        `Too many attempts. Try again in ${humanRetry(limit.retryAfterMs)}.`,
      );
    }

    const form = await ctx.req.formData();
    const parsed = BookingSchema.safeParse({
      name: form.get("name"),
      email: form.get("email"),
      notes: form.get("notes") ?? "",
      date: form.get("date"),
      slot: form.get("slot"),
      website: form.get("website") ?? "",
    });
    if (!parsed.success) {
      return errRedirect(
        cfg,
        parsed.error.issues[0]?.message ?? "Invalid form data.",
      );
    }
    const input = parsed.data;

    // Honeypot — silently accept and pretend to succeed (no booking).
    if (input.website.trim() !== "") {
      // Redirect to confirmed with a fake id; no email sent, no booking created.
      // Bots think they succeeded and go away.
      return Response.redirect(
        new URL(
          `/confirmed?id=fake&token=fake`,
          cfg.publicUrl,
        ).toString(),
        303,
      );
    }

    // Sanity: slot must be within availability, not booked, not in the past.
    const minStart = new Date(Date.now() + cfg.minNoticeHours * 3600_000);
    const slotInstant = zonedDateTime(input.date, input.slot, cfg.hostTz);
    if (slotInstant < minStart) {
      return errRedirect(cfg, "That time is no longer available.", input.date);
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
        cfg,
        "That time is outside availability hours.",
        input.date,
      );
    }

    // Blocked date?
    if (cfg.blockedDates.has(input.date)) {
      return errRedirect(
        cfg,
        "That date is not available for booking.",
        input.date,
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
    const bookingId = (await import("../../lib/tokens.ts"))
      .generateBookingId();
    const booking = {
      id: bookingId,
      createdAt: new Date().toISOString(),
      date: input.date,
      time: input.slot,
      hostTz: cfg.hostTz,
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
        cfg,
        "We couldn't send your confirmation email, so the booking was not created. Please try again in a moment.",
        input.date,
      );
    }

    // Phase 2: persist under the mutex. Re-check the conflict because
    // a concurrent request could have taken the slot in the few
    // milliseconds between Phase 1 and Phase 2.
    try {
      const result = await ctx.state.bookings.mutate(async (draft) => {
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
          cfg,
          "That time was just booked by someone else. The confirmation email you received is no longer valid — please pick another time.",
          input.date,
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
        cfg,
        "Your confirmation was sent, but we couldn't save the booking on our end. Please contact the host directly to confirm.",
        input.date,
      );
    }

    return Response.redirect(
      new URL(`/confirmed?id=${bookingId}&token=${tokenRaw}`, cfg.publicUrl)
        .toString(),
      303,
    );
  },
});
