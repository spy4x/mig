import { useState } from "preact/hooks";
import type { JSX } from "preact";

/*
  Booking submit island.

  Wraps the submit <button> so we can show a spinner + disable the
  button while the form is in flight. The form's POST goes to /api/book
  which always responds with a 303 redirect — so this button never
  needs to "succeed", it just needs to be visibly busy until the
  navigation kicks in.

  No-JS fallback: if the island never hydrates, the button is still a
  real <button type="submit"> with the same label and submits normally.
  We avoid putting the spinner markup on the server because that would
  leak into the no-JS path and confuse screen readers.
*/

interface Props {
  slot: string;
  children: preact.ComponentChildren;
}

export default function BookingSubmit({ slot, children }: Props) {
  const [busy, setBusy] = useState(false);

  function onClick(e: JSX.TargetedMouseEvent<HTMLButtonElement>) {
    const form = (e.currentTarget as HTMLButtonElement).form;
    if (form && !form.checkValidity()) {
      // Let the browser show native validation messages.
      return;
    }
    setBusy(true);
    // We deliberately don't preventDefault — the form submission
    // proceeds normally. Worst case: the spinner shows for a few
    // hundred ms while the browser navigates away.
  }

  return (
    <button
      type="submit"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy ? "true" : undefined}
      class="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 hover:bg-brand-600 active:bg-brand-600 disabled:bg-brand-400 disabled:cursor-wait px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-(--duration-snappy) hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
    >
      {busy
        ? (
          <>
            <Spinner />
            <span>Confirming…</span>
          </>
        )
        : <span>{children}</span>}
      {
        /* Visually hidden but always rendered so screen readers hear
         the time even when the spinner replaces the visible label. */
      }
      <span class="sr-only">at {slot}</span>
    </button>
  );
}

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      aria-hidden="true"
      class="animate-spin"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
