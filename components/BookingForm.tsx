/*
  Booking form — name + email + optional notes. Submits to /api/book
  which redirects to /confirmed?id=...&token=... on success or back
  to /?err=... on failure.

  The submit button is wrapped in an island (BookingSubmit) so we can
  disable it + show a spinner during submission without losing the
  no-JS fallback. The form's <button> still works fine without the
  island — it's the same <button type="submit"> element either way.
*/

import BookingSubmit from "../islands/BookingSubmit.tsx";

interface BookingFormProps {
  date: string;
  slot: string;
  durationMin: number;
  hostName: string;
  /** Server-rendered inline error from ?err= query param. */
  error?: string | null;
}

export function BookingForm({
  date,
  slot,
  durationMin,
  hostName,
  error,
}: BookingFormProps) {
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
        action="/api/book"
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

        <div class="pt-1">
          <BookingSubmit slot={slot}>
            Confirm — {slot}
          </BookingSubmit>
          <p class="text-xs text-ink-subtle mt-2.5">
            We'll send a confirmation email with a calendar invite.
          </p>
        </div>
      </form>
    </div>
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
