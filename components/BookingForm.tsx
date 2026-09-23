/*
  Booking form — name + email + optional notes. Submits to `action`
  (default /api/book, "/embed/book" on the embed variant) which
  redirects to `${basePath}/confirmed?id=...&token=...` on success or
  back to the picker root with `?err=...` on failure.

  The submit button label includes both date and time ("Confirm —
  Fri, 28 Aug, 14:00") so the user can sanity-check their pick right
  up to the click. On the standalone page the button is hydrated into
  the BookingSubmit island so we can show a spinner while the form is
  in flight. /embed never mounts islands (issue #11 — a partial iframe
  allow-list must not depend on a script tag loading), so `basePath !==
  ""` renders a plain <button type="submit"> instead: same label, no
  spinner, no client-side pre-validation. Server-side Zod is already
  the trust boundary either way.

  Timezone capture works the same way, split by the same island/no-island
  line: the standalone form's guestTz field is filled by the
  BookingSubmit island after mount; /embed's is filled by a tiny inline
  <script> (lib/guest-tz-script.ts), the same progressive-enhancement
  pattern routes/_app.tsx uses for the theme bootstrap. Neither runs
  without JavaScript, and in that case the field stays empty — the
  server already treats guestTz as optional and falls back to the
  host's timezone.

  No-JS fallback: without the island the standalone button is still a
  real <button type="submit"> with the same label.
*/

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
  /** "" for the standalone page (posts to /api/book, no island), "/embed"
   *  for the iframe variant (posts to /embed/book, no island). Defaults
   *  to "". */
  basePath?: string;
  /** The visitor's IANA zone, already known from /embed's `tz` query
   *  param (mig#15) — pre-fills the hidden `guestTz` field so a
   *  booking is correct even if the confirm step's inline capture
   *  script (below) never runs. Ignored on the standalone page, which
   *  has no query-param zone and relies on the BookingSubmit island
   *  instead. */
  guestTz?: string | null;
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
}: BookingFormProps) {
  const embed = basePath !== "";
  const action = embed ? `${basePath}/book` : "/api/book";
  return (
    <div class="rounded-2xl border border-line bg-surface-raised overflow-hidden">
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

        {error && (
          <div
            role="alert"
            class="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </div>
        )}

        <Field
          label="Your name"
          name="name"
          required
          minLength={2}
          maxLength={100}
          autocomplete="name"
          placeholder="Jane Doe"
        />
        <Field
          label="Email"
          name="email"
          type="email"
          required
          autocomplete="email"
          placeholder="jane@example.com"
        />
        <Field
          label="Notes"
          name="notes"
          textarea
          maxLength={500}
          placeholder="Anything I should know before we meet?"
          optional
        />

        {
          /* Honeypot — offscreen, real users never fill. Bots that skip
           CSS-hidden fields get bitten here. */
        }
        <div
          aria-hidden="true"
          style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden"
        >
          <label>
            Website
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autocomplete="off"
            />
          </label>
        </div>

        {
          /* Progressive-enhancement timezone capture — /embed's
             equivalent of BookingSubmit's hidden guestTz field, since
             /embed mounts no island (issue #11 Option A). Without
             this script the field just stays empty and the booking
             still completes; lib/book.ts already treats guestTz as
             optional. */
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
  the server's Zod validation is the trust boundary regardless.
*/
function PlainSubmitButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      class="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-brand-500 hover:bg-brand-600 active:bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-(--duration-snappy) hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
    >
      <span>{label}</span>
    </button>
  );
}

interface FieldProps {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  autocomplete?: string;
  placeholder?: string;
  textarea?: boolean;
  optional?: boolean;
}

function Field(p: FieldProps) {
  const id = `f-${p.name}`;
  const base =
    "block w-full rounded-lg border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle/70 transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";
  return (
    <div>
      <label
        for={id}
        class="flex items-center justify-between text-sm font-medium text-ink mb-1.5"
      >
        <span>
          {p.label}
          {p.optional && (
            <span class="text-ink-subtle font-normal ml-1">(optional)</span>
          )}
        </span>
      </label>
      {p.textarea
        ? (
          <textarea
            id={id}
            name={p.name}
            required={p.required}
            maxLength={p.maxLength}
            rows={3}
            placeholder={p.placeholder}
            class={`${base} resize-y min-h-[5rem]`}
          />
        )
        : (
          <input
            id={id}
            name={p.name}
            type={p.type ?? "text"}
            required={p.required}
            minLength={p.minLength}
            maxLength={p.maxLength}
            autocomplete={p.autocomplete}
            placeholder={p.placeholder}
            class={base}
          />
        )}
    </div>
  );
}
