// Pure formatting for one arktype config-validation issue. No side
// effects, no import of lib/config.ts (or arktype itself — it only needs
// the three primitive fields any arktype ArkErrors issue carries), so it
// can be unit-tested directly without booting the app's env parsing.

/** Renders one arktype issue as a single startup-log line, naming the
 *  variable and never the value.
 *
 *  `expected` (arktype's description of the failed rule — "a URL
 *  string", "at least length 16", "an integer") is safe to print for
 *  most issue codes: `predicate`, `domain`, `required`,
 *  `min`/`max`/`divisor` and their `intersection` combination never
 *  embed the checked value. The `union` code is the exception — for a
 *  two-branch union (a raw `boolean`, or a narrow string-literal
 *  union like `'light' | 'dark'`) arktype builds `expected` from the
 *  *whole* top-level message, which does embed the value (e.g.
 *  `THEME must be "dark" or "light" (was "blue-secret")`). Rather
 *  than special-case which unions are "safe" (a 3-way union
 *  happens not to hit this path today, but a future field could),
 *  every `union` issue gets the generic message unconditionally —
 *  arktype escapes special characters when it quotes the value inside
 *  `expected` (e.g. `was "bogus\"MK"`), so a plain substring check
 *  alone can miss it. Every issue whose `expected` happens to contain
 *  the raw value verbatim (any other code) also gets the generic
 *  message, as a second line of defense.
 *
 *  `raw` is the *original* env string for that variable (never the
 *  defaulted/coerced candidate value ConfigSchema actually saw), so
 *  the leak check compares against what the operator actually typed.
 */
export function formatConfigIssue(
  name: string,
  raw: string | undefined,
  code: string,
  expected: string,
): string {
  if (raw === undefined) return `  ${name}: is not set`;
  if (code === "union" || (raw !== "" && expected.includes(raw))) {
    return `  ${name}: has an invalid value`;
  }
  const flattened = expected
    .split("\n")
    .map((line) => line.replace(/^\s*◦\s*/, "").trim())
    .filter((line) => line.length > 0)
    .join(" and ")
    .replace(/\s+/g, " ")
    .trim();
  return `  ${name}: must be ${flattened}`;
}
