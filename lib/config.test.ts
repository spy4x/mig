// lib/config.ts exits the process on invalid env (Deno.exit(1)), which a
// same-process test can't observe without killing the test runner itself —
// so these run it in a child process, the same shape as the boot check in
// the PR description, and assert on its exit code + stderr.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { type } from "arktype";

// formatConfigIssue is a pure function, so — unlike the rest of this file —
// it doesn't need a subprocess to test. But lib/config.ts computes and
// exports `config` as a module-level side effect (`Deno.exit(1)` on an
// invalid env), so importing it in-process only works once the current
// process's env is already fully valid. Set it before the dynamic import
// below runs (top-level code in this file executes before any Deno.test
// body does), and clear every optional/defaulted key first in case the
// shell running the tests happens to export one of them (PORT, THEME, …).
const VALID_ENV: Record<string, string> = {
  HOST_NAME: "Jane Doe",
  HOST_EMAIL: "jane@example.com",
  HOST_TZ: "Europe/Berlin",
  MEETING_URL: "https://meet.example.com/room",
  PUBLIC_URL: "https://mig.example.com",
  WEEKLY_AVAILABILITY: "MON-FRI 09:00-17:00",
  SLOT_DURATION_MIN: "30",
  SMTP_HOST: "smtp.example.com",
  SMTP_USER: "jane@example.com",
  SMTP_PASSWORD: "not-a-real-secret",
  SMTP_FROM: "Bookings <book@example.com>",
  // Not a real secret — a fixed fixture string, long enough to satisfy the
  // >=16-char constraint under test.
  CANCEL_SECRET: "test-cancel-secret-not-real-000",
};

const OPTIONAL_KEYS = [
  "MIN_NOTICE_HOURS",
  "BOOKING_HORIZON_DAYS",
  "BLOCKED_DATES",
  "RATE_LIMIT_PER_5MIN",
  "THEME",
  "SMTP_PORT",
  "PORT",
  "DATA_PATH",
  "HIDE_BRANDING",
  "GITHUB_URL",
  "MIG_VERSION",
];
for (const key of OPTIONAL_KEYS) Deno.env.delete(key);
for (const [key, value] of Object.entries(VALID_ENV)) Deno.env.set(key, value);
const { formatConfigIssue } = await import("./config.ts");

async function runConfig(
  env: Record<string, string>,
): Promise<{ code: number; stderr: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-env", "--allow-read", "lib/config.ts"],
    cwd: Deno.cwd(),
    env,
    clearEnv: true,
    stdout: "null",
    stderr: "piped",
  });
  const { code, stderr } = await command.output();
  return { code, stderr: new TextDecoder().decode(stderr) };
}

/** Boots config.ts in a child process and prints one field of the
 *  resulting `Config` to stdout — for pinning a *value* (a default, a
 *  coercion result), not just "did it exit 0". JSON-encoded so the
 *  caller gets the exact string (including any leading/trailing
 *  whitespace the value itself carries) — a plain `.trim()` on the
 *  captured stdout would silently strip that too and hide a missing
 *  trim in `config.ts` itself. */
async function runConfigField(
  env: Record<string, string>,
  field: string,
): Promise<unknown> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      // `deno eval` already runs with every permission — Deno 2.9.5 (CI's
      // and the Dockerfile's version) rejects `--allow-env`/`--allow-read`
      // here as unrecognized arguments.
      `const { config } = await import(\`file://\${Deno.cwd()}/lib/config.ts\`); console.log(JSON.stringify(config.${field}))`,
    ],
    cwd: Deno.cwd(),
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "inherit",
  });
  const { stdout } = await command.output();
  return JSON.parse(new TextDecoder().decode(stdout));
}

Deno.test("config: boots with a fully valid env", async () => {
  const { code, stderr } = await runConfig(VALID_ENV);
  assertEquals(code, 0, stderr);
});

Deno.test("config: exits 1 naming a non-numeric SLOT_DURATION_MIN", async () => {
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    SLOT_DURATION_MIN: "not-a-number",
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "SLOT_DURATION_MIN");
});

Deno.test("config: exits 1 naming a missing required var", async () => {
  const env = { ...VALID_ENV };
  delete env.HOST_EMAIL;
  const { code, stderr } = await runConfig(env);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "HOST_EMAIL");
});

Deno.test("config: exits 1 naming a malformed HOST_EMAIL", async () => {
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    HOST_EMAIL: "not-an-email",
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "HOST_EMAIL");
});

Deno.test("config: exits 1 naming a too-short CANCEL_SECRET", async () => {
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    CANCEL_SECRET: "short",
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "CANCEL_SECRET");
});

Deno.test("config: exits 1 naming an invalid THEME", async () => {
  const { code, stderr } = await runConfig({ ...VALID_ENV, THEME: "blue" });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "THEME");
});

// mig#3 review round 1: HOST_EMAIL goes through the same shared
// lib/email-pattern.ts Email type as BookingSchema's email field — pin
// the same Zod-parity boundary here too.
Deno.test("config: accepts an apostrophe in HOST_EMAIL's local part (Zod parity)", async () => {
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    HOST_EMAIL: "o'brien@example.com",
  });
  assertEquals(code, 0, stderr);
});

for (
  const bad of [
    "a..b@example.com",
    ".a@example.com",
    "a.@example.com",
    "a%b@example.com",
    "a@-example.com",
    "a@example..com",
  ]
) {
  Deno.test(`config: rejects HOST_EMAIL=${bad} (Zod parity)`, async () => {
    const { code, stderr } = await runConfig({ ...VALID_ENV, HOST_EMAIL: bad });
    assertEquals(code, 1);
    assertStringIncludes(stderr, "HOST_EMAIL");
  });
}

Deno.test("config: MIN_NOTICE_HOURS defaults to 6 when unset", async () => {
  const env = { ...VALID_ENV };
  delete env.MIN_NOTICE_HOURS;
  const value = await runConfigField(env, "minNoticeHours");
  assertEquals(value, 6);
});

// mig#3 review round 1: arktype's default messages echo the actual bad
// value ("... (was \"<value>\")"), which for a type/pattern mismatch is
// the raw env string itself — a malformed MEETING_URL carrying a
// passcode-looking query param must not reach the container's logs.
Deno.test("config: a malformed MEETING_URL is named but its value is not echoed to stderr", async () => {
  const secretLooking = "not a url ?token=SUPER-SECRET-PASSCODE";
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    MEETING_URL: secretLooking,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MEETING_URL");
  assertEquals(
    stderr.includes("SUPER-SECRET-PASSCODE"),
    false,
    `stderr echoed the bad value:\n${stderr}`,
  );
});

// arktype reports two or more rules failing on the same field
// (SLOT_DURATION_MIN "500.5" is both non-integer and over 480) as a
// bulleted list in `expected` — formatConfigIssue flattens that into
// one line instead of printing arktype's own multi-line rendering,
// which embeds the value.
Deno.test("config: a value failing two rules at once names the field with both rules flattened, not echoed", async () => {
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    SLOT_DURATION_MIN: "500.5",
  });
  assertEquals(code, 1);
  assertStringIncludes(
    stderr,
    "  SLOT_DURATION_MIN: must be an integer and at most 480",
  );
  assertEquals(
    stderr.includes("500.5"),
    false,
    `stderr echoed the bad value:\n${stderr}`,
  );
});

Deno.test("config: SLOT_DURATION_MIN accepts 480, rejects 481", async () => {
  const at480 = await runConfig({ ...VALID_ENV, SLOT_DURATION_MIN: "480" });
  assertEquals(at480.code, 0, at480.stderr);

  const at481 = await runConfig({ ...VALID_ENV, SLOT_DURATION_MIN: "481" });
  assertEquals(at481.code, 1);
  assertStringIncludes(at481.stderr, "SLOT_DURATION_MIN");
});

// Pins the CANCEL_SECRET minimum at 16 characters, not 15.
Deno.test("config: CANCEL_SECRET accepts 16 chars, rejects 15", async () => {
  const at16 = await runConfig({
    ...VALID_ENV,
    CANCEL_SECRET: "a".repeat(16),
  });
  assertEquals(at16.code, 0, at16.stderr);

  const at15 = await runConfig({
    ...VALID_ENV,
    CANCEL_SECRET: "a".repeat(15),
  });
  assertEquals(at15.code, 1);
  assertStringIncludes(at15.stderr, "CANCEL_SECRET");
});

// Pins the PORT default at 8080, not 8081.
Deno.test("config: PORT defaults to 8080 when unset", async () => {
  const env = { ...VALID_ENV };
  delete env.PORT;
  const value = await runConfigField(env, "port");
  assertEquals(value, 8080);
});

// mig#36: a startup error must never leak the offending value, even when
// the value itself contains text shaped like the strip patterns a prior
// approach used (a line separator, or the literal text a two-rule failure
// message uses). Each marker below is unique and must never reach stderr.
Deno.test("config: a MEETING_URL with a line separator is named but not echoed", async () => {
  const marker = "LINESEP-MARKER-7f3a";
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    MEETING_URL: `not a url\u2028${marker}`,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MEETING_URL");
  assertEquals(
    stderr.includes(marker),
    false,
    `stderr echoed the bad value:\n${stderr}`,
  );
});

Deno.test("config: a MEETING_URL containing ') must be (' is named but not echoed", async () => {
  const marker = "PARENMARKER-9c21";
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    MEETING_URL: `not a url ${marker}) must be (`,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "MEETING_URL");
  assertEquals(
    stderr.includes(marker),
    false,
    `stderr echoed the bad value:\n${stderr}`,
  );
});

Deno.test("config: a missing HOST_NAME is reported as 'is not set'", async () => {
  const env = { ...VALID_ENV };
  delete env.HOST_NAME;
  const { code, stderr } = await runConfig(env);
  assertEquals(code, 1);
  assertStringIncludes(stderr, "  HOST_NAME: is not set");
});

Deno.test("config: a THEME value with a unique marker is named but not echoed", async () => {
  const marker = "THEME-MARKER-6ax1";
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    THEME: `bogus-${marker}`,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "THEME");
  assertEquals(
    stderr.includes(marker),
    false,
    `stderr echoed the bad value:\n${stderr}`,
  );
});

Deno.test("config: MIG_VERSION is trimmed", async () => {
  const value = await runConfigField(
    { ...VALID_ENV, MIG_VERSION: "  1.2.3  " },
    "version",
  );
  assertEquals(value, "1.2.3");
});

// mig#36 round 2: formatConfigIssue is the single place a startup error
// line gets built, so it's pinned directly rather than only through the
// subprocess-based tests above.

Deno.test("formatConfigIssue: an absent variable is reported as 'is not set', ignoring code/expected", () => {
  assertEquals(
    formatConfigIssue("HOST_NAME", undefined, "required", "a string"),
    "  HOST_NAME: is not set",
  );
});

// The bug this round fixes: a two-branch union (a raw boolean, or a
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
    formatConfigIssue("SLOT_DURATION_MIN", "500.5", issue.code, issue.expected),
    "  SLOT_DURATION_MIN: must be an integer and at most 480",
  );
});
