// POST /api/cancel — cancel a booking. Form fields: id, token, reason.

import { define } from "../../lib/utils.ts"
import { verifyOpaqueToken } from "@spy4x/platform/tokens"
import { capRedirectField, readBoundedForm } from "../../lib/book.ts"
import { sendCancellationEmails } from "../../lib/email.ts"
import { notifyBookingCancelled } from "../../lib/notify.ts"
import { NOTES_MAX_LENGTH } from "../../lib/validators.ts"

/** The reason as it is stored and mailed to the owner: trimmed and cut
 *  to the length the booking form's notes may have. The form's own
 *  `maxlength` is only a browser's promise, so a longer reason is cut
 *  here rather than refused: the cancellation still goes through
 *  (mig#108). A cut never leaves half of a surrogate pair behind. */
function boundedReason(raw: string): string {
  return raw.trim().slice(0, NOTES_MAX_LENGTH).replace(/[\uD800-\uDBFF]$/, "")
    .trimEnd()
}

/** An address on mig's own origin with `params` set one by one, so a
 *  `#` or `&` in a value stays inside that value. `id` and `token` are
 *  cut to the booking route's redirect-field length, so a long value
 *  never makes a long `Location` header (mig#113). */
function redirectTo(
  publicUrl: string,
  path: string,
  params: Record<string, string>,
): Response {
  const url = new URL(path, publicUrl)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, capRedirectField(value) ?? "")
  }
  return Response.redirect(url.toString(), 303)
}

export const handler = define.handlers({
  async POST(ctx) {
    const cfg = ctx.state.config
    // A stranger can post here, so the body is read with the booking
    // route's cap and deadline before anything else (mig#113).
    const read = await readBoundedForm(ctx.req)
    if (!read.ok) return read.error
    const form = read.value
    const id = String(form.get("id") ?? "")
    const token = String(form.get("token") ?? "")
    const reason = boundedReason(String(form.get("reason") ?? ""))

    if (!id || !token) {
      return redirectTo(cfg.publicUrl, "/cancel", { err: "missing" })
    }
    const back = () => redirectTo(cfg.publicUrl, "/cancel", { id, token })

    const booking = ctx.state.bookings.get(id)
    if (!booking) return back()
    const tokenOk = await verifyOpaqueToken(
      token,
      booking.cancelTokenHash,
      cfg.cancelSecret,
    )
    if (!tokenOk || booking.status === "cancelled") return back()

    // Determine who is cancelling. The cancel URL is the same for owner
    // and guest — the recipient of the cancellation email reveals it.
    // Owner always receives the email; guest only receives if they cancel.
    const cancelledBy: "owner" | "guest" = "guest" // best guess; refined below
    const cancelledAt = new Date().toISOString()

    try {
      await ctx.state.bookings.mutate((draft) => {
        const b = draft.find((x) => x.id === id)
        if (!b) return
        b.status = "cancelled"
        b.cancelledAt = cancelledAt
        b.cancelledBy = cancelledBy
        b.cancelledReason = reason || undefined
      })
    } catch (e) {
      console.error("mig: cancel failed:", e)
      return back()
    }

    // Re-fetch to get the freshly-mutated record
    const updated = ctx.state.bookings.get(id)
    if (!updated) {
      return redirectTo(cfg.publicUrl, "/", { err: "cancel" })
    }

    const sent = await sendCancellationEmails(
      cfg,
      updated,
      cancelledBy,
      reason,
    )
    if (!sent.ok) {
      console.error("mig: cancellation email failed:", sent.error)
    }

    // NTFY push for the cancellation (subject to NTFY_MODE).
    await notifyBookingCancelled(cfg, updated, cancelledBy, reason)

    return redirectTo(cfg.publicUrl, "/confirmed", {
      id,
      token,
      cancelled: "1",
    })
  },
})
