// POST /embed/book — the /embed variant of POST /api/book.
//
// Same form fields, same validation, same email + persist flow (see
// lib/book.ts) — the only difference is the base path: success
// redirects to /embed/confirmed instead of /confirmed, failure
// redirects back to /embed instead of /. That keeps a booking started
// inside the iframe from ever navigating the frame to a URL the host's
// `frame-ancestors: /embed` allow-list would refuse to render
// (issue #11).

import { define } from "../../lib/utils.ts";
import { handleBookingSubmit } from "../../lib/book.ts";

export const handler = define.handlers({
  POST(ctx) {
    return handleBookingSubmit(ctx, "/embed");
  },
});
