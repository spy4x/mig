import { useState } from "preact/hooks";

/*
  Booking submit island.

  Shows a spinner while the form is in flight so the visitor gets
  feedback between click and the redirect landing on /confirmed.

  Subtle bug we just fixed: an earlier version set `disabled={busy}`
  on the button during the click handler. Preact re-renders
  synchronously inside the event, so by the time the browser
  checked the button to fire the form's submit event, the button
  was disabled — and the form never submitted. We now keep the
  button enabled and rely on aria-busy + a visual swap for the
  in-flight state. The page navigates away a few hundred ms later
  so the visual-only state is fine.
*/

interface Props {
  /** Full button label, e.g. "Confirm — Fri, 28 Aug, 14:00". */
  label: string;
}

export default function BookingSubmit({ label }: Props) {
  const [busy, setBusy] = useState(false);

  function onClick() {
    setBusy(true);
    // Do NOT preventDefault — the native form submit must proceed.
  }

  return (
    <button
      type="submit"
      onClick={onClick}
      aria-busy={busy ? "true" : undefined}
      class="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-brand-500 hover:bg-brand-600 active:bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-(--duration-snappy) hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
    >
      {busy
        ? (
          <>
            <Spinner />
            <span>Confirming…</span>
          </>
        )
        : <span>{label}</span>}
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
