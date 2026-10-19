import { useEffect, useState } from "preact/hooks"
import { captureTimeZone } from "@spy4x/platform/browser/embed"
import { isAddress } from "@spy4x/email/address"
import { Button } from "@spy4x/preact-ui/button"

/*
  Booking submit island.

  Two responsibilities, both client-side UX only:

  1. Validation short-circuit. The native form posts to /api/book
     which validates server-side via arktype (the trust boundary). But
     if the form is empty / malformed, posting and waiting for the
     303 redirect with ?err=… means the button briefly enters its
     "Confirming…" spinner state — and on slow networks that
     spinner can sit for many seconds with no feedback, looking
     broken. Fix: validate locally first, and if invalid, hand each
     field its error (shown under it, focus on the first) AND prevent the submit so the button label
     never flips to "Confirming…". Server arktype still runs on the
     valid path as the source of truth.

  2. Visitor timezone capture. Same as before — read
     `Intl.DateTimeFormat().resolvedOptions().timeZone` on mount and
     stash it in a hidden field so the server can render the
     booking's email + ICS in the visitor's TZ (server-side TZ fix
     shipped in PR #7).
*/

/** What is wrong with each field, by its `name`; a field with no entry is fine. */
export interface FieldErrors {
  name?: string
  email?: string
}

interface Props {
  /** Full button label, e.g. "Confirm — Fri, 28 Aug, 14:00".
   *  Already in visitor TZ (the BookingFlow island re-formats it
   *  after hydration). */
  label: string
  /** Receives the field errors of each click, `{}` when the form is
   *  fine, so the form shows each one under its field. Always rendered
   *  inside the BookingFlow island, so a function prop is fine here. */
  onFieldErrors?: (errors: FieldErrors) => void
}

// Mirrors lib/validators.ts:BookingSchema (name min 2, the address
// check behind the server's `emailAddress` rule). `isAddress` comes
// from @spy4x/email/address, not `isEmailAddress` from
// @spy4x/platform/validation/predicates: that module builds an arktype
// type at load and would put arktype in the island's bundle. The
// server adds the 254-character limit; server-side arktype is the
// trust boundary and this is UX only.
const NAME_MIN = 2
const NAME_MAX = 100

/** The first problem with the name and with the email, in the order the form shows them. */
export function validateBooking(name: string, email: string): FieldErrors {
  const errors: FieldErrors = {}
  const n = name.trim()
  const e = email.trim()
  if (n.length < NAME_MIN) errors.name = "Enter your name."
  else if (n.length > NAME_MAX) {
    errors.name = "Enter a name of 100 characters or fewer."
  }
  if (!e) errors.email = "Enter your email."
  else if (!isAddress(e)) {
    errors.email = "Enter an email address like name@example.com."
  }
  return errors
}

export default function BookingSubmit({ label, onFieldErrors }: Props) {
  const [busy, setBusy] = useState(false)
  const [guestTz, setGuestTz] = useState("")

  useEffect(() => {
    // Stays empty when no zone is detected; the server then falls back
    // to the host's timezone.
    setGuestTz(captureTimeZone() ?? "")
  }, [])

  function onClick(e: MouseEvent) {
    // The native form-submit fires after this handler resolves. We
    // can stop it by calling preventDefault, which is what we do
    // when validation fails. On success we let the native submit
    // proceed so the form posts to /api/book.
    const btn = e.currentTarget as HTMLButtonElement
    const form = btn.form
    if (!form) return
    const fd = new FormData(form)
    const errors = validateBooking(
      String(fd.get("name") ?? ""),
      String(fd.get("email") ?? ""),
    )
    onFieldErrors?.(errors)
    if (errors.name || errors.email) {
      e.preventDefault()
      // Move focus to the first invalid field for keyboard users.
      form.querySelector<HTMLElement>(errors.name ? "#f-name" : "#f-email")
        ?.focus()
      return
    }
    setBusy(true)
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
        class="w-full"
      >
        {label}
      </Button>
    </>
  )
}
