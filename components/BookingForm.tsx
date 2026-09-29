/*
  Booking form — name + email + optional notes. Submits to `action`
  (default /api/book, "/embed/book" on the embed variant) which
  redirects to `${basePath}/confirmed?id=...&token=...` on success or
  back to the picker root with `?err=...` on failure.

  The submit button label includes both date and time ("Confirm —
  Fri, 28 Aug, 14:00") so the user can sanity-check their pick right
  up to the click. On the standalone page the button is hydrated into
  the BookingSubmit island so we can show a spinner while the form is
  in flight. /embed (`basePath !== ""`) renders a plain
  <button type="submit"> instead: same label, no spinner, no
  client-side pre-validation. Server-side arktype is already the trust
  boundary either way. BookingSubmit fills guestTz with a freshly
  detected zone, which would overwrite the `tz` /embed pre-fills below
  (mig#15), so /embed keeps its own field.

  Timezone capture is split the same way: the standalone form's
  guestTz field is filled by the BookingSubmit island after mount;
  /embed's is pre-filled from its `tz` query param and, when that is
  empty, by a tiny inline <script> (lib/guest-tz-script.ts). Neither
  runs without JavaScript, and in that case the field stays empty — the
  server already treats guestTz as optional and falls back to the
  host's timezone.

  No-JS fallback: without the island the standalone button is still a
  real <button type="submit"> with the same label.
*/

import { Button } from "@spy4x/preact-ui/button";
import { Field } from "@spy4x/preact-ui/field";
import { honeypotField } from "@spy4x/preact-ui/honeypot";
import { Input, Textarea } from "@spy4x/preact-ui/input";
import BookingSubmit from "../islands/BookingSubmit.tsx";
import { guestTzCaptureScript } from "../lib/guest-tz-script.ts";

const GUEST_TZ_INPUT_ID = "mig-embed-guest-tz";

interface BookingFormProps {
  date: string;
  slot: string;
  dateLabel: string;
  durationMin: number;
  hostName: string;
  /** Server-rendered inline error from ?err= query param. */
  error?: string | null;
  /** Pre-computed confirm button label — "Confirm — Fri, 28 Aug,
   *  14:00". Computed by the route so it stays in lockstep with
   *  the rest of the host-local time presentation. */
  confirmLabel: string;
  /** "" for the standalone page (posts to /api/book, BookingSubmit island), "/embed"
   *  for the iframe variant (posts to /embed/book, plain button). Defaults
   *  to "". */
  basePath?: string;
  /** The visitor's IANA zone, already known from /embed's `tz` query
   *  param (mig#15) — pre-fills the hidden `guestTz` field so a
   *  booking is correct even if the confirm step's inline capture
   *  script (below) never runs. Ignored on the standalone page, which
   *  has no query-param zone and relies on the BookingSubmit island
   *  instead. */
  guestTz?: string | null;
  /** /embed's forced theme, once known (mig#44) — carried as a hidden
   *  `theme` field so a redirect back to /embed after a failed
   *  submission (lib/book.ts's errRedirect) still knows which theme to
   *  force. `null` for "auto" (the default), which renders no hidden
   *  field — a request that never named a theme shouldn't gain one on
   *  its first failure. Ignored on the standalone page (no embed
   *  theme to carry). */
  theme?: string | null;
}

export function BookingForm({
  date,
  slot,
  dateLabel: _dateLabel,
  durationMin,
  hostName,
  error,
  confirmLabel,
  basePath = "",
  guestTz,
  theme,
}: BookingFormProps) {
  const embed = basePath !== "";
  const action = embed ? `${basePath}/book` : "/api/book";
  return (
    <div class="rounded-2xl border border-line bg-surface overflow-hidden">
      <div class="px-5 py-4 border-b border-line">
        <p class="text-sm text-ink-muted">
          <span class="text-ink font-medium">{durationMin} minutes</span>{" "}
          <span class="text-ink-subtle">·</span>{" "}
          <span class="text-ink-subtle">with {hostName}</span>
        </p>
      </div>

      <form
        method="POST"
        action={action}
        class="px-5 py-5 space-y-4"
        aria-label="Booking details"
      >
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="slot" value={slot} />
        {embed && theme && <input type="hidden" name="theme" value={theme} />}

        {error && (
          <div
            role="alert"
            class="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </div>
        )}

        <Field id="f-name" label="Your name">
          <Input
            name="name"
            required
            minLength={2}
            maxLength={100}
            autocomplete="name"
            placeholder="Jane Doe"
          />
        </Field>
        <Field id="f-email" label="Email">
          <Input
            name="email"
            type="email"
            required
            autocomplete="email"
            placeholder="jane@example.com"
          />
        </Field>
        <Field id="f-notes" label="Notes" hint="Optional">
          <Textarea
            name="notes"
            rows={3}
            maxLength={500}
            placeholder="Anything I should know before we meet?"
            class="resize-y min-h-[5rem]"
          />
        </Field>

        {
          /* Honeypot — off-screen, real users never fill it. The server
            rejects a booking whose `website` field has text in it. */
        }
        {honeypotField("website", "Website")}

        {
          /* Progressive-enhancement timezone capture — /embed's
             equivalent of BookingSubmit's hidden guestTz field (see the
             header comment). Without this script the field just stays
             empty and the booking still completes; lib/book.ts already
             treats guestTz as optional. */
        }
        {embed && (
          <>
            <input
              type="hidden"
              name="guestTz"
              id={GUEST_TZ_INPUT_ID}
              value={guestTz ?? ""}
            />
            <script
              dangerouslySetInnerHTML={{
                __html: guestTzCaptureScript(GUEST_TZ_INPUT_ID),
              }}
            />
          </>
        )}

        <div class="pt-1">
          {embed
            ? <PlainSubmitButton label={confirmLabel} />
            : <BookingSubmit label={confirmLabel} />}
          <p class="text-xs text-ink-subtle mt-2.5">
            We'll send a confirmation email with a calendar invite.
          </p>
        </div>
      </form>
    </div>
  );
}

// "Fri, 28 Aug, 14:00" — short enough to fit on one line in the
// button at mobile widths. The TZ used here is the browser's local
// TZ because that's what the visitor sees on screen — they should be
// able to verify the date/time they're agreeing to.

/*
  PlainSubmitButton — the /embed fallback for BookingSubmit.

  Same visual contract as the island's idle state (no spinner, no
  client-side pre-validation, no guestTz capture — those all need
  JS). A real <button type="submit"> works with no script at all;
  the server's arktype validation is the trust boundary regardless.
*/
function PlainSubmitButton({ label }: { label: string }) {
  return (
    <Button type="submit" class="w-full sm:w-auto">
      {label}
    </Button>
  );
}
