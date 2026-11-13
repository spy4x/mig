// What the booking form says about each mistake, in one place, so the
// submit button (islands/BookingSubmit.tsx) and the server
// (lib/validators.ts) word the same mistake the same way (mig#125).
// Plain strings only: the island imports this file, and arktype must
// stay out of its bundle.

export const NAME_MISSING = "Enter your name."
export const NAME_TOO_LONG = "Enter a name of 100 characters or fewer."
export const EMAIL_MISSING = "Enter your email."
export const EMAIL_INVALID = "Enter an email address like name@example.com."
/** The hidden time zone field held no zone mig knows, or one over 100 characters. */
export const TIME_ZONE_UNREADABLE =
  "Your time zone could not be read. Reload the page and try again."
