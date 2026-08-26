// POST /api/book — create a booking. Form fields:
//   name, email, notes (optional), date, slot, website (honeypot)
//
// On success: 303 redirect to /confirmed?id=...&token=...
// On failure: 303 redirect to /?err=...

import { define } from "../../lib/utils.ts";
import { newCancelToken } from "../../lib/tokens.ts";
import { sendBookingEmails } from "../../lib/email.ts";
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

    // Atomic create
    let tokenRaw = "";
    let bookingId = "";
    try {
      const result = await ctx.state.bookings.mutate(async (draft) => {
        // Final conflict check under mutex
        const conflict = draft.find(
          (b) =>
            b.status === "active" &&
            b.date === input.date &&
            b.time === input.slot,
        );
        if (conflict) {
          return { ok: false as const };
        }
        const { raw, hash } = await newCancelToken(cfg.cancelSecret);
        tokenRaw = raw;
        const now = new Date().toISOString();
        const id = (await import("../../lib/tokens.ts")).generateBookingId();
        bookingId = id;
        draft.push({
          id,
          createdAt: now,
          date: input.date,
          time: input.slot,
          hostTz: cfg.hostTz,
          guestName: input.name.trim(),
          guestEmail: input.email.trim().toLowerCase(),
          notes: input.notes.trim() || undefined,
          cancelTokenHash: hash,
          status: "active",
        });
        return { ok: true as const };
      });
      if (!result.ok) {
        return errRedirect(
          cfg,
          "That time was just booked. Please pick another.",
          input.date,
        );
      }
    } catch (e) {
      console.error("mig: booking create failed:", e);
      return errRedirect(
        cfg,
        "Could not save the booking. Please try again.",
        input.date,
      );
    }

    // Send emails (fail-closed: if SMTP fails, the booking remains but we
    // still try to surface a useful error to the user).
    try {
      const cancelUrl = new URL(
        `/cancel?id=${bookingId}&token=${tokenRaw}`,
        cfg.publicUrl,
      ).toString();
      const booking = ctx.state.bookings.get(bookingId);
      if (!booking) throw new Error("booking disappeared after create");
      await sendBookingEmails(cfg, booking, cancelUrl);
    } catch (e) {
      // Booking is persisted (fail-closed) but the confirmation email
      // didn't go out. We have no other notification path in v1, so the
      // message is honest: the booking is on file, no email was sent,
      // and the host is *not* automatically notified — they'll only
      // see it via `docker logs hl-mig` or by manually inspecting
      // /data/bookings.json.
      console.error("mig: email send failed:", e);
      return Response.redirect(
        new URL(
          `/?err=${
            encodeURIComponent(
              "Booking saved, but we couldn't send a confirmation email. The host has not been notified automatically — please contact them to confirm.",
            )
          }&date=${input.date}`,
          cfg.publicUrl,
        ).toString(),
        303,
      );
    }

    return Response.redirect(
      new URL(`/confirmed?id=${bookingId}&token=${tokenRaw}`, cfg.publicUrl)
        .toString(),
      303,
    );
  },
});
