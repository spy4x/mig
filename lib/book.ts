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
import {
  sendBookingCorrectionEmail,
  sendGuestBookingEmail,
  sendOwnerBookingEmail,
} from "./email.ts";
import { notifyBookingEmailFailed, notifyBookingSucceeded } from "./notify.ts";
import { clientIp, humanRetry } from "@spy4x/platform/rate-limit/client-ip";
import { zonedDateTime } from "@spy4x/time/tz";
import { EARLIEST_DATE, hostSlotInstant } from "./clock.ts";
import { BookingSchema } from "./validators.ts";

/** "" → "/", "/embed" → "/embed" — where a failed submission redirects
 *  back to (the picker root). */
function formPath(basePath: string): string {
  return basePath === "" ? "/" : basePath;
}

// mig#18: a redirect field's raw form value, truncated to a sane
// length. `date` and `tz` never legitimately exceed a few dozen
// characters (an ISO date, an IANA zone name) — this is purely a cap
// against carrying an attacker-sized value into a `Location` header
// before BookingSchema's own validation ever gets a chance to reject
// it outright.
const MAX_REDIRECT_FIELD_LEN = 100;

function capRedirectField(value: string | undefined): string | undefined {
  return value !== undefined && value.length > MAX_REDIRECT_FIELD_LEN
    ? value.slice(0, MAX_REDIRECT_FIELD_LEN)
    : value;
}

export async function handleBookingSubmit(
  ctx: Context<State>,
  basePath: string,
): Promise<Response> {
  const cfg = ctx.state.config;
  // `true` trusts CF-Connecting-IP, then X-Forwarded-For's first hop,
  // then X-Real-IP — mig's own order before mig#57 (the ts-libs default,
  // `false`, would put every visitor in one "0.0.0.0" bucket, since no
  // socket address is passed). This trusts headers any client can set:
  // compose.example.yml publishes port 8080 directly, and a client
  // there picks its own bucket by sending CF-Connecting-IP. See
  // https://github.com/spy4x/mig/issues/59 for the fix.
  const ip = clientIp(ctx.req, undefined, true);

  function errRedirect(
    message: string,
    state?: { date?: string; slot?: string; tz?: string; theme?: string },
  ): Response {
    const params = new URLSearchParams({ err: message });
    if (state?.date) params.set("date", state.date);
    if (state?.slot) params.set("slot", state.slot);
    if (state?.tz) params.set("tz", state.tz);
    if (state?.theme) params.set("theme", state.theme);
    return Response.redirect(
      new URL(`${formPath(basePath)}?${params.toString()}`, cfg.publicUrl)
        .toString(),
      303,
    );
  }

  // Read the form before the rate-limit check, so a rate-limited
  // submission still redirects with the visitor's picked date and
  // zone (mig#18) — dropping both sent them back to the date picker
  // from scratch. `slot` is deliberately left off that one redirect
  // below: a rate-limited request never got far enough to confirm the
  // slot is still free, unlike the failure modes below that already
  // checked it moments earlier.
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
  //
  // mig#18: these come straight off the wire, before BookingSchema's
  // own length limits run (a rate-limited or otherwise-early-failing
  // request never reaches `safeParse` below) — an attacker sending a
  // 200,000-character `date` or `tz` would otherwise ride, uncapped,
  // straight into the redirect's `Location` header. Capped here, not
  // just left to the redirect target's own route to re-reject, so the
  // header itself never grows past a form value's worth of junk.
  // theme (mig#44): same raw-passthrough, capped-length treatment as
  // date/tz — /embed's BookingForm only ever sends "light" or "dark"
  // (never "auto", which renders no hidden field at all), and
  // routes/embed/index.tsx re-validates whatever comes back through
  // lib/theme.ts's parseThemeParam, falling back to "auto" for
  // anything else — so passing the raw value through here never
  // bypasses that.
  const redirectDateTz = {
    date: capRedirectField(String(form.get("date") || "") || undefined),
    tz: capRedirectField(String(form.get("guestTz") || "") || undefined),
    theme: capRedirectField(String(form.get("theme") || "") || undefined),
  };
  const redirectState = {
    ...redirectDateTz,
    slot: capRedirectField(String(form.get("slot") || "") || undefined),
  };

  // Rate limit per IP
  const limit = ctx.state.rateLimiter.check(ip);
  if (!limit.allowed) {
    return errRedirect(
      `Too many attempts. Try again in ${humanRetry(limit.retryAfterMs)}.`,
      redirectDateTz,
    );
  }
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
    const fakeUrl = new URL(`${basePath}/confirmed`, cfg.publicUrl);
    fakeUrl.searchParams.set("id", "fake");
    fakeUrl.searchParams.set("token", "fake");
    if (redirectDateTz.theme) {
      fakeUrl.searchParams.set("theme", redirectDateTz.theme);
    }
    return Response.redirect(fakeUrl.toString(), 303);
  }

  // Sanity: slot must be within availability, not booked, not in the past.
  // This and every other availability/conflict/persist failure below
  // drops `slot` — it's no longer a valid pick, so keeping it would
  // land the visitor back on the confirm step for a slot they can't
  // book (mig#15 round 2).
  const minStart = new Date(Date.now() + cfg.minNoticeHours * 3600_000);
  // The validator checked the calendar. Before EARLIEST_DATE the host's
  // zone may not resolve the slot to the minute — Phoenix ran on a local
  // mean time until noon on 1883-11-18 — and the zone math below would
  // throw (mig#57).
  if (input.date < EARLIEST_DATE) {
    return errRedirect(
      "That date is not available for booking.",
      redirectDateTz,
    );
  }
  const slotInstant = hostSlotInstant(input.date, input.slot, cfg.hostTz);
  // A spring-forward gap time (mig#57): the host's clock never shows
  // it, so no slot was offered for it either.
  if (!slotInstant) {
    return errRedirect(
      "That time is outside availability hours.",
      redirectDateTz,
    );
  }
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

  // Transactional booking flow: save first, then send (mig#19). A
  // saved booking with no email can still be undone — both catch
  // blocks below delete it again with a second mutate() (one for a
  // save that half-failed, one for a send that failed outright), and
  // the guest is none the wiser. An email that went out for a booking
  // that was never saved cannot be undone: there is no "unsend" for a
  // "Booking confirmed" message that already carries a calendar
  // invite, and the visitor is left holding a confirmation for a
  // meeting the host never agreed to. The conflict check — the only
  // place two concurrent requests for the same slot actually collide
  // — therefore has to run before any mail goes out, not after. The
  // previous order (email, then persist) got this backwards: the
  // loser of the race still had its email sent before the conflict
  // was ever detected.
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

  // Phase 1: persist under the mutex, conflict check inside the same
  // mutation. Whichever concurrent request reaches this first wins
  // the slot; the loser finds out here, before it has sent anything.
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
      // Someone else's request took the slot first. No email was
      // ever sent for this one, so there's nothing to warn the guest
      // about beyond the slot being gone.
      return errRedirect(
        "That time was just booked by someone else. Please pick another time.",
        redirectDateTz,
      );
    }
  } catch (e) {
    // The save itself failed — but BookingsStore.mutate() assigns
    // `this.bookings = draft` *before* it awaits persist() (see
    // lib/bookings.ts), so the booking pushed above is already
    // sitting in the in-memory array even though the write to disk
    // just threw. Left alone, the slot would show as booked, a retry
    // would be told "just booked by someone else", nobody would ever
    // get an email or a notification, and the next unrelated write
    // would flush this orphan to disk. Undo the in-memory push with a
    // second mutate() — the same shape as the rollback below — before
    // telling the guest anything. That second mutate() assigns before
    // it writes too, so the removal holds even if this write also
    // fails.
    console.error("mig: persist FAILED; booking=" + bookingId, e);
    try {
      await ctx.state.bookings.mutate((draft) => {
        const idx = draft.findIndex((b) => b.id === bookingId);
        if (idx !== -1) draft.splice(idx, 1);
      });
    } catch (rollbackErr) {
      // mutate() assigns `this.bookings = draft` *before* it awaits
      // persist(), so the in-memory removal above always lands even
      // when this second write also fails — only the on-disk copy can
      // still hold the booking here.
      console.error(
        "mig: rollback FAILED after persist failed; booking=" +
          bookingId + " may still be on disk",
        rollbackErr,
      );
    }
    return errRedirect(
      "We couldn't save your booking. Please try again in a moment.",
      redirectDateTz,
    );
  }

  // Phase 2: the booking is saved — send the emails, owner first
  // (lib/email.ts). A failed send here undoes the save instead of
  // leaving a booking on disk with no confirmation and no working
  // cancel link. `ownerEmailSucceeded` records whether the owner's
  // "New booking" email actually went out before a later failure, so
  // the catch block below knows whether it needs to correct that
  // email rather than just roll the booking back silently.
  let ownerEmailSucceeded = false;
  try {
    const cancelUrl = new URL(
      `/cancel?id=${bookingId}&token=${tokenRaw}`,
      cfg.publicUrl,
    ).toString();
    await sendOwnerBookingEmail(cfg, booking, cancelUrl);
    ownerEmailSucceeded = true;
    await sendGuestBookingEmail(cfg, booking, cancelUrl);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("mig: email send failed; rolling back booking:", msg);
    let rolledBack = true;
    try {
      await ctx.state.bookings.mutate((draft) => {
        const idx = draft.findIndex((b) => b.id === bookingId);
        if (idx !== -1) draft.splice(idx, 1);
      });
    } catch (rollbackErr) {
      rolledBack = false;
      // The booking is now stuck on disk — log loudly so the host can
      // clean it up by hand; still redirect the guest with the same
      // message, since they genuinely never got a confirmation. The
      // log says whether the owner's email went out before the guest's
      // one failed (ownerEmailSucceeded, set above), since that used
      // to always say "no email sent", which is false whenever it did.
      console.error(
        "mig: rollback FAILED after email send failed; booking=" +
          bookingId + " may still be on disk; owner email " +
          (ownerEmailSucceeded ? "was sent" : "was not sent"),
        rollbackErr,
      );
    }
    // Optional NTFY push so the host gets a heads-up outside the
    // email channel. Sent after the rollback above, not before: its
    // wording depends on whether the rollback actually removed the
    // booking, and that's only known once the rollback has run — a
    // push sent earlier would always claim "removed, slot free again"
    // even on the rare run where the rollback write itself also
    // fails. Awaited, not fire-and-forget: notify() in lib/notify.ts
    // already swallows and logs its own transport errors, so awaiting
    // it adds real latency but no new failure mode.
    await notifyBookingEmailFailed(cfg, booking, msg, { rolledBack });
    // mig#19 review round 3: the owner's "New booking" email (and
    // calendar invite) already went out above — correct it, since the
    // NTFY push just above is optional and off unless NTFY_* is
    // configured. No correction when the owner send itself was the
    // one that failed: in that case nobody got anything to correct.
    if (ownerEmailSucceeded) {
      try {
        await sendBookingCorrectionEmail(cfg, booking, { rolledBack });
      } catch (correctionErr) {
        console.error(
          "mig: correction email FAILED after rollback; booking=" +
            bookingId +
            "; host still has a stale 'New booking' email and invite",
          correctionErr,
        );
      }
    }
    // review follow-up: this message used to say "we couldn't send
    // your confirmation email", which names the visitor's own email
    // as the culprit even when it was the *owner's* send that failed
    // (the guest's never even ran) — the visitor has no way to know
    // which recipient's send actually failed, so the message must not
    // guess. Neutral wording covers both failure modes identically.
    return errRedirect(
      "Something went wrong, so the booking was not created. Please try again in a moment.",
      redirectState,
    );
  }

  // Booking persisted and email sent — fire the success notification
  // (subject to NTFY_MODE in lib/notify.ts).
  await notifyBookingSucceeded(cfg, booking);

  const successUrl = new URL(`${basePath}/confirmed`, cfg.publicUrl);
  successUrl.searchParams.set("id", bookingId);
  successUrl.searchParams.set("token", tokenRaw);
  if (redirectDateTz.theme) {
    successUrl.searchParams.set("theme", redirectDateTz.theme);
  }
  return Response.redirect(successUrl.toString(), 303);
}
