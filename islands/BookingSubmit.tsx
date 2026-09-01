import { useEffect, useState } from "preact/hooks";

/*
  Booking submit island.

  Two responsibilities, both client-side UX only:

  1. Validation short-circuit. The native form posts to /api/book
     which validates server-side via Zod (the trust boundary). But
     if the form is empty / malformed, posting and waiting for the
     303 redirect with ?err=… means the button briefly enters its
     "Confirming…" spinner state — and on slow networks that
     spinner can sit for many seconds with no feedback, looking
     broken. Fix: validate locally first, and if invalid, surface
     an inline error AND prevent the submit so the button label
     never flips to "Confirming…". Server Zod still runs on the
     valid path as the source of truth.

  2. Visitor timezone capture. Same as before — read
     `Intl.DateTimeFormat().resolvedOptions().timeZone` on mount and
     stash it in a hidden field so the server can render the
     booking's email + ICS in the visitor's TZ (server-side TZ fix
     shipped in PR #7).
*/

interface Props {
  /** Full button label, e.g. "Confirm — Fri, 28 Aug, 14:00".
   *  Already in visitor TZ (the BookingFlow island re-formats it
   *  after hydration). */
  label: string;
}

// Mirrors routes/api/_validators.ts:BookingSchema (name min 2, email
// shape). Server-side Zod is the trust boundary — this is UX only.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MIN = 2;
const NAME_MAX = 100;

export default function BookingSubmit({ label }: Props) {
  const [busy, setBusy] = useState(false);
  const [guestTz, setGuestTz] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setGuestTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      // Keep field empty. Server falls back to host timezone.
    }
  }, []);

  function validate(form: HTMLFormElement): string | null {
    const fd = new FormData(form);
    const name = String(fd.get("name") ?? "").trim();
    const email = String(fd.get("email") ?? "").trim();
    if (name.length < NAME_MIN) {
      return "Please enter your name.";
    }
    if (name.length > NAME_MAX) {
      return "Name is too long.";
    }
    if (!email) {
      return "Please enter your email.";
    }
    if (!EMAIL_RE.test(email)) {
      return "Please enter a valid email address.";
    }
    return null;
  }

  function onClick(e: MouseEvent) {
    // The native form-submit fires after this handler resolves. We
    // can stop it by calling preventDefault, which is what we do
    // when validation fails. On success we let the native submit
    // proceed so the form posts to /api/book.
    const btn = e.currentTarget as HTMLButtonElement;
    const form = btn.form;
    if (!form) return;
    const err = validate(form);
    if (err) {
      e.preventDefault();
      setError(err);
      // Move focus to the first invalid field for keyboard users.
      const firstInvalid = form.querySelector<HTMLElement>(
        err.startsWith("Please enter your name") ? "#f-name" : "#f-email",
      );
      firstInvalid?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    // Do NOT preventDefault — the native form submit must proceed.
  }

  return (
    <>
      <input type="hidden" name="guestTz" value={guestTz} />
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
      {error && (
        <p
          role="alert"
          class="mt-2.5 text-xs font-medium text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </>
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
