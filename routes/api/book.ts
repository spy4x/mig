// POST /api/book — create a booking. Form fields:
//   name, email, notes (optional), date, slot, guestTz (optional), website (honeypot)
//
// On success: 303 redirect to /confirmed?id=...&token=...
// On failure: 303 redirect to /?err=...
//
// The standalone (non-embed) entry point. /embed posts to
// routes/embed/book.ts instead, which shares the same logic with a
// different base path — see lib/book.ts.

import { define } from "../../lib/utils.ts";
import { handleBookingSubmit } from "../../lib/book.ts";

export const handler = define.handlers({
  POST(ctx) {
    return handleBookingSubmit(ctx, "");
  },
});
