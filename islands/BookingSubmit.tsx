import { useEffect, useState } from "preact/hooks";
import { captureTimeZone } from "@spy4x/platform/browser/embed";
import { isAddress } from "@spy4x/email/address";
import { Button } from "@spy4x/preact-ui/button";

/*
  Booking submit island.

  Two responsibilities, both client-side UX only:

  1. Validation short-circuit. The native form posts to /api/book
     which validates server-side via arktype (the trust boundary). But
     if the form is empty / malformed, posting and waiting for the
     303 redirect with ?err=… means the button briefly enters its
     "Confirming…" spinner state — and on slow networks that
     spinner can sit for many seconds with no feedback, looking
     broken. Fix: validate locally first, and if invalid, surface
     an inline error AND prevent the submit so the button label
     never flips to "Confirming…". Server arktype still runs on the
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

// Mirrors lib/validators.ts:BookingSchema (name min 2, the address
// check behind the server's `emailAddress` rule). `isAddress` comes
// from @spy4x/email/address, not `isEmailAddress` from
// @spy4x/platform/validation/predicates: that module builds an arktype
// type at load and would put arktype in the island's bundle. The
// server adds the 254-character limit; server-side arktype is the
// trust boundary and this is UX only.
const NAME_MIN = 2;
const NAME_MAX = 100;

export default function BookingSubmit({ label }: Props) {
  const [busy, setBusy] = useState(false);
  const [guestTz, setGuestTz] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Stays empty when no zone is detected; the server then falls back
    // to the host's timezone.
    setGuestTz(captureTimeZone() ?? "");
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
    if (!isAddress(email)) {
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
      <Button
        type="submit"
        onClick={onClick}
        busy={busy}
        busyLabel="Confirming…"
        class="w-full sm:w-auto"
      >
        {label}
      </Button>
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
