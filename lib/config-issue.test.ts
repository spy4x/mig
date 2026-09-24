// formatConfigIssue is a pure function with no side effects (see its doc
// comment in lib/config-issue.ts for why it exists), so it's tested
// directly — no subprocess, no env setup. It must not import lib/config.ts,
// whose module-level `Deno.exit(1)`-on-invalid-env side effect is exactly
// what these tests need to stay clear of.

import { assertEquals } from "@std/assert";
import { type } from "arktype";
import { formatConfigIssue } from "./config-issue.ts";

Deno.test("formatConfigIssue: an absent variable is reported as 'is not set', ignoring code/expected", () => {
  assertEquals(
    formatConfigIssue("HOST_NAME", undefined, "required", "a string"),
    "  HOST_NAME: is not set",
  );
});

// The bug fixed in mig#36 round 2: a two-branch union (a raw boolean, or a
// narrowed string-literal union) makes arktype build `expected` from the
// *whole* top-level message, which embeds the value. Every `union` issue
// gets the generic message, regardless of what `expected` says.
Deno.test("formatConfigIssue: a union-code issue gets the generic message, never `expected`", () => {
  const marker = "UNION-MARKER-4b1";
  const leaky = `THEME must be "dark" or "light" (was "${marker}")`;
  assertEquals(
    formatConfigIssue("THEME", marker, "union", leaky),
    "  THEME: has an invalid value",
  );
});

// mig#36 round 3: arktype escapes quote characters when it embeds the raw
// value inside `expected` (`was "bogus\"MK"`), so a plain
// `expected.includes(raw)` check misses it — this needs the unconditional
// `code === "union"` branch, not the includes fallback, to catch it. This
// is the case round 2's reviewer found: deleting `code === "union" ||`
// alone left every then-existing test green because that test's marker
// had no special characters, so `includes` happened to catch it anyway.
Deno.test("formatConfigIssue: a union issue whose escaped value defeats a plain includes() check still gets the generic message", () => {
  const raw = 'bogus"MK';
  const expected = 'THEME must be "dark" or "light" (was "bogus\\"MK")';
  assertEquals(expected.includes(raw), false, "test fixture is unsound");
  assertEquals(
    formatConfigIssue("THEME", raw, "union", expected),
    "  THEME: has an invalid value",
  );
});

// mig#42: HIDE_BRANDING has a fixed, name-keyed message (FIXED_MESSAGES in
// lib/config-issue.ts) that lists its accepted values, regardless of what
// arktype's `expected` says — the raw value in `expected` here proves it's
// ignored, not just absent from this particular fixture.
Deno.test("formatConfigIssue: HIDE_BRANDING gets its fixed accepted-values message, never `expected`", () => {
  const marker = "HIDE-BRANDING-MARKER-9k2";
  const leaky = `HIDE_BRANDING must be boolean (was "${marker}")`;
  assertEquals(
    formatConfigIssue("HIDE_BRANDING", marker, "union", leaky),
    "  HIDE_BRANDING: must be true, false, 1, 0, yes, no or empty",
  );
});

// A variable with no FIXED_MESSAGES entry keeps the generic union handling.
Deno.test("formatConfigIssue: a non-HIDE_BRANDING union issue still gets the generic message", () => {
  const marker = "UNION-OTHER-MARKER-3q7";
  const leaky = `THEME must be "dark" or "light" (was "${marker}")`;
  assertEquals(
    formatConfigIssue("THEME", marker, "union", leaky),
    "  THEME: has an invalid value",
  );
});

// FIXED_MESSAGES is looked up with Object.hasOwn, not `in`: `in` walks the
// prototype chain, so a variable name that collides with an inherited
// Object.prototype member (e.g. "toString") would otherwise return that
// member's value instead of falling through to the generic message.
Deno.test("formatConfigIssue: a variable named like an inherited Object member still gets the generic message", () => {
  assertEquals(
    formatConfigIssue("toString", "x", "union", "e"),
    "  toString: has an invalid value",
  );
});

// An absent HIDE_BRANDING must still say "is not set", not consult
// FIXED_MESSAGES — that check runs before the name lookup.
Deno.test("formatConfigIssue: an absent HIDE_BRANDING is reported as 'is not set', not its fixed message", () => {
  assertEquals(
    formatConfigIssue("HIDE_BRANDING", undefined, "union", "boolean"),
    "  HIDE_BRANDING: is not set",
  );
});

// Belt and suspenders: even a non-union code whose `expected` happens to
// contain the raw value verbatim must not print it.
Deno.test("formatConfigIssue: a non-union issue whose expected contains the raw value also gets the generic message", () => {
  const marker = "GENERIC-MARKER-2ee9";
  assertEquals(
    formatConfigIssue("MEETING_URL", marker, "predicate", `oops ${marker}`),
    "  MEETING_URL: has an invalid value",
  );
});

Deno.test("formatConfigIssue: an empty raw value never falsely matches `expected`", () => {
  // "" is a substring of every string, so the includes-check must not
  // treat a present-but-empty variable as an `expected`-leak.
  assertEquals(
    formatConfigIssue("HOST_NAME", "", "domain", "a string"),
    "  HOST_NAME: must be a string",
  );
});

Deno.test("formatConfigIssue: a single failing rule prints arktype's real 'expected' text", () => {
  const result = type("string.url")("not-a-url");
  if (!(result instanceof type.errors)) throw new Error("expected a failure");
  const [issue] = result;
  assertEquals(issue.code, "predicate");
  assertEquals(
    formatConfigIssue("MEETING_URL", "not-a-url", issue.code, issue.expected),
    "  MEETING_URL: must be a URL string",
  );
});

Deno.test("formatConfigIssue: two rules failing at once are flattened into one line, using arktype's real wording", () => {
  const result = type("1 <= number.integer <= 480")(500.5);
  if (!(result instanceof type.errors)) throw new Error("expected a failure");
  const [issue] = result;
  assertEquals(issue.code, "intersection");
  assertEquals(
    formatConfigIssue(
      "SLOT_DURATION_MIN",
      "500.5",
      issue.code,
      issue.expected,
    ),
    "  SLOT_DURATION_MIN: must be an integer and at most 480",
  );
});
