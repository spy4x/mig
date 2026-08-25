// POST /api/cancel — cancel a booking. Form fields: id, token, reason.

import { define } from "../../lib/utils.ts";
import { verifyCancelToken } from "../../lib/tokens.ts";
import { sendCancellationEmails } from "../../lib/email.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const cfg = ctx.state.config;
    const form = await ctx.req.formData();
    const id = String(form.get("id") ?? "");
    const token = String(form.get("token") ?? "");
    const reason = String(form.get("reason") ?? "").trim();

    if (!id || !token) {
      return Response.redirect(
        new URL("/cancel?err=missing", cfg.publicUrl).toString(),
        303,
      );
    }

    const booking = ctx.state.bookings.get(id);
    if (!booking) {
      return Response.redirect(
        new URL(`/cancel?id=${id}&token=${token}`, cfg.publicUrl).toString(),
        303,
      );
    }
    const tokenOk = await verifyCancelToken(
      token,
      booking.cancelTokenHash,
      cfg.cancelSecret,
    );
    if (!tokenOk || booking.status === "cancelled") {
      return Response.redirect(
        new URL(`/cancel?id=${id}&token=${token}`, cfg.publicUrl).toString(),
        303,
      );
    }

    // Determine who is cancelling. The cancel URL is the same for owner
    // and guest — the recipient of the cancellation email reveals it.
    // Owner always receives the email; guest only receives if they cancel.
    const cancelledBy: "owner" | "guest" = "guest"; // best guess; refined below
    const cancelledAt = new Date().toISOString();

    try {
      await ctx.state.bookings.mutate((draft) => {
        const b = draft.find((x) => x.id === id);
        if (!b) return;
        b.status = "cancelled";
        b.cancelledAt = cancelledAt;
        b.cancelledBy = cancelledBy;
        b.cancelledReason = reason || undefined;
      });
    } catch (e) {
      console.error("mig: cancel failed:", e);
      return Response.redirect(
        new URL(`/cancel?id=${id}&token=${token}`, cfg.publicUrl).toString(),
        303,
      );
    }

    // Re-fetch to get the freshly-mutated record
    const updated = ctx.state.bookings.get(id);
    if (!updated) {
      return Response.redirect(
        new URL("/?err=cancel", cfg.publicUrl).toString(),
        303,
      );
    }

    try {
      await sendCancellationEmails(cfg, updated, cancelledBy, reason);
    } catch (e) {
      console.error("mig: cancellation email failed:", e);
    }

    return Response.redirect(
      new URL(`/confirmed?id=${id}&token=${token}&cancelled=1`, cfg.publicUrl)
        .toString(),
      303,
    );
  },
});
