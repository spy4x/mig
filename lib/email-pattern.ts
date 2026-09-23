// arktype's built-in `string.email` keyword uses a different (RFC-leaning)
// pattern than Zod 3's `.email()` did — Zod rejected `a..b@example.com`,
// `.a@example.com`, `a.@example.com`, `a%b@example.com`, `a@-example.com`
// and `a@example..com`, and accepted `o'brien@example.com`; swapping in
// arktype's keyword flipped every one of those. Reproduced here verbatim
// from zod 3.25.76's `v3/types.js` (`emailRegex`, case-insensitive) so both
// lib/validators.ts (booking email) and lib/config.ts (HOST_EMAIL) keep
// accepting and rejecting exactly what they did before the migration off
// Zod (mig#3).
import { type } from "arktype";

export const EMAIL_PATTERN =
  /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;

// Built once at module level and shared, rather than re-narrowed per call
// site — both consumers just need "does this string match", and reuse the
// same arktype node.
export const Email = type("string").narrow((s, ctx) =>
  EMAIL_PATTERN.test(s) || ctx.mustBe("a valid email address")
);
