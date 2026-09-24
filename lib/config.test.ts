// lib/config.ts exits the process on invalid env (Deno.exit(1)), which a
// same-process test can't observe without killing the test runner itself —
// so every test in this file runs it in a child process and asserts on its
// exit code + stderr. The child's `cwd` is a fresh, empty temp directory
// (never the repo root): lib/config.ts's `loadEnv` reads a `.env` from its
// cwd, and running from the repo root would pick up the developer's own
// `.env` — silently filling in variables a test deliberately left out, or
// even making the child process import fail outright on a value the
// developer's `.env` happens to set. The script itself is still referenced
// by its real (absolute) path, since the child's cwd no longer contains it.

import { assertEquals, assertStringIncludes } from "@std/assert";

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

const CONFIG_SCRIPT_PATH = new URL("./config.ts", import.meta.url);
// The child's cwd is a temp dir with no deno.json, so bare specifiers
// like "arktype" (mapped in the repo's deno.json) would fail to resolve
// without pointing it at the real config explicitly.
const DENO_CONFIG_PATH = new URL("../deno.json", import.meta.url);

/** Runs `fn` with a fresh, empty temp directory as `cwd`-equivalent
 *  isolation for a child `Deno.Command`, removing the directory
 *  afterward regardless of outcome. */
async function withIsolatedCwd<T>(
  fn: (cwd: string) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir();
  try {
    return await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function runConfig(
  env: Record<string, string>,
): Promise<{ code: number; stderr: string }> {
  return await withIsolatedCwd(async (cwd) => {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-env",
        "--allow-read",
        "--config",
        decodeURIComponent(DENO_CONFIG_PATH.pathname),
        CONFIG_SCRIPT_PATH.href,
      ],
      cwd,
      env,
      clearEnv: true,
      stdout: "null",
      stderr: "piped",
    });
    const { code, stderr } = await command.output();
    return { code, stderr: new TextDecoder().decode(stderr) };
  });
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
  return await withIsolatedCwd(async (cwd) => {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        // `deno eval` already runs with every permission — Deno 2.9.5
        // (CI's and the Dockerfile's version) rejects
        // `--allow-env`/`--allow-read` here as unrecognized arguments.
        "--config",
        decodeURIComponent(DENO_CONFIG_PATH.pathname),
        `const { config } = await import(${
          JSON.stringify(CONFIG_SCRIPT_PATH.href)
        }); console.log(JSON.stringify(config.${field}))`,
      ],
      cwd,
      env,
      clearEnv: true,
      stdout: "piped",
      stderr: "piped",
    });
    const { code, stdout, stderr } = await command.output();
    if (code !== 0) {
      throw new Error(
        `child exited ${code}: ${new TextDecoder().decode(stderr)}`,
      );
    }
    return JSON.parse(new TextDecoder().decode(stdout));
  });
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
// bulleted list in `expected` — formatConfigIssue (lib/config-issue.ts)
// flattens that into one line instead of printing arktype's own
// multi-line rendering, which embeds the value.
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
    MEETING_URL: `not a url ${marker}`,
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

// mig#35: HIDE_BRANDING was parsed with Boolean(raw), so "false" and "0"
// (and any other non-empty string) turned into true. Each accepted
// spelling below is pinned individually; the true/false split matters,
// not just "did it parse".
for (
  const raw of ["false", "0", "no", "FALSE", "  FALSE  "]
) {
  Deno.test(`config: HIDE_BRANDING=${JSON.stringify(raw)} shows the branding`, async () => {
    const value = await runConfigField(
      { ...VALID_ENV, HIDE_BRANDING: raw },
      "hideBranding",
    );
    assertEquals(value, false);
  });
}

for (
  const raw of ["true", "1", "yes", "TRUE", " Yes "]
) {
  Deno.test(`config: HIDE_BRANDING=${JSON.stringify(raw)} hides the branding`, async () => {
    const value = await runConfigField(
      { ...VALID_ENV, HIDE_BRANDING: raw },
      "hideBranding",
    );
    assertEquals(value, true);
  });
}

Deno.test("config: HIDE_BRANDING empty string shows the branding", async () => {
  const value = await runConfigField(
    { ...VALID_ENV, HIDE_BRANDING: "" },
    "hideBranding",
  );
  assertEquals(value, false);
});

Deno.test("config: HIDE_BRANDING whitespace-only shows the branding", async () => {
  const value = await runConfigField(
    { ...VALID_ENV, HIDE_BRANDING: "   " },
    "hideBranding",
  );
  assertEquals(value, false);
});

Deno.test("config: HIDE_BRANDING absent shows the branding", async () => {
  const env = { ...VALID_ENV };
  delete env.HIDE_BRANDING;
  const value = await runConfigField(env, "hideBranding");
  assertEquals(value, false);
});

// Each raw value here doubles as its own marker: it must be rejected
// verbatim (not just "some invalid string"), so the test can't swap in an
// unrelated random marker without losing coverage of that exact spelling —
// "on" in particular guards against a coerceHideBranding accepting it as a
// synonym for "true". A plain `stderr.includes(raw)` would false-positive
// on "on", since the fixed preamble "invalid environment configuration"
// already contains that substring; assertRawValueNotLeaked checks for the
// value as a whole token (not preceded/followed by an identifier
// character) instead.
function assertRawValueNotLeaked(stderr: string, raw: string): void {
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`);
  assertEquals(
    pattern.test(stderr),
    false,
    `stderr echoed the bad value:\n${stderr}`,
  );
}

// mig#42: the fixed message below (lib/config-issue.ts's FIXED_MESSAGES)
// itself contains the word "no", so a naive substring check for a marker
// like "on" could false-positive against it. It can't here: checked by
// hand, none of the markers in the loop below ("on", "off", "2", "-1",
// "truee", "y") is itself a substring of "must be true, false, 1, 0, yes,
// no or empty" at all — the message has no "on", "off", "2", "-1", "truee"
// or standalone "y" anywhere in it — so assertRawValueNotLeaked's
// whole-token check needs no stripping of the fixed message from stderr
// before it runs.
for (const raw of ["on", "off", "2", "-1", "truee", "y"]) {
  Deno.test(`config: HIDE_BRANDING=${JSON.stringify(raw)} is rejected, not echoed`, async () => {
    const { code, stderr } = await runConfig({
      ...VALID_ENV,
      HIDE_BRANDING: raw,
    });
    assertEquals(code, 1);
    assertStringIncludes(stderr, "HIDE_BRANDING");
    assertRawValueNotLeaked(stderr, raw);
  });
}

// mig#42: HIDE_BRANDING's startup error used to just say "has an invalid
// value" — this pins the fixed, accepted-values message it prints instead.
Deno.test("config: HIDE_BRANDING=on prints the accepted values, not just 'invalid'", async () => {
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    HIDE_BRANDING: "on",
  });
  assertEquals(code, 1);
  assertStringIncludes(
    stderr,
    "  HIDE_BRANDING: must be true, false, 1, 0, yes, no or empty",
  );
  assertRawValueNotLeaked(stderr, "on");
});

// mig#38: HOST_TZ, WEEKLY_AVAILABILITY and BLOCKED_DATES bypass
// ConfigSchema (they're checked by hand after arktype passes, see
// lib/config.ts) and used to interpolate the raw value straight into the
// startup log line. Each marker below is unique and must never reach
// stderr; the variable name and, for the two list vars, the 1-based
// position of the bad entry, must.

Deno.test("config: an invalid HOST_TZ is named but not echoed", async () => {
  const marker = "TZ-MARKER-4k9d";
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    HOST_TZ: `Not/A/Zone-${marker}`,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "HOST_TZ");
  assertRawValueNotLeaked(stderr, marker);
});

// mig#38 round 2: only a BLOCKED_DATES *range* runs Intl-backed tz math
// against HOST_TZ (via parseBlockedDates -> expandDateRange -> addDays) —
// a plain list of single dates never calls into it, so a version of this
// test using single dates can't actually catch HOST_TZ being validated
// too late. With the HOST_TZ check moved back to run after BLOCKED_DATES,
// this used to print `mig: BLOCKED_DATES: entry 1: Invalid time zone
// specified: <the HOST_TZ value>` — the timezone's own value, leaked
// through a variable it doesn't even belong to.
Deno.test("config: an invalid HOST_TZ is reported as HOST_TZ, not BLOCKED_DATES, with a blocked-date range set", async () => {
  const marker = "TZ-ORDER-MARKER-7q2w";
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    HOST_TZ: `Not/A/Real/Zone-${marker}`,
    BLOCKED_DATES: "2026-12-24..2026-12-26",
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "HOST_TZ");
  assertEquals(
    stderr.includes("BLOCKED_DATES"),
    false,
    `stderr blamed BLOCKED_DATES instead of HOST_TZ:\n${stderr}`,
  );
  assertRawValueNotLeaked(stderr, marker);
});

// Each WEEKLY_AVAILABILITY case below is built to reach its own message,
// not the generic "invalid, expected e.g." fallback every case used to
// fall through to. Day codes and HH:MM digits can't carry a long unique
// marker (the entry pattern requires exactly 3 letters / 2 digits), so
// those assert the exact value-free message instead; only the unknown-day
// case has room for one (an arbitrary day code).

Deno.test("config: a WEEKLY_AVAILABILITY unknown day (inside a range) is named by position, not echoed", async () => {
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    WEEKLY_AVAILABILITY: "MON 09:00-17:00, MON-QZX 09:00-17:00",
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "WEEKLY_AVAILABILITY: entry 2: unknown day");
  assertEquals(
    stderr.includes("QZX"),
    false,
    `stderr echoed the bad day code:\n${stderr}`,
  );
});

Deno.test("config: a WEEKLY_AVAILABILITY time out of range is named by position, value-free", async () => {
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    WEEKLY_AVAILABILITY: "MON 09:00-17:00, TUE 25:00-26:00",
  });
  assertEquals(code, 1);
  assertStringIncludes(
    stderr,
    "WEEKLY_AVAILABILITY: entry 2: time out of range (hour 0-24, minute 0-59)",
  );
  assertEquals(stderr.includes("25:00"), false, `stderr echoed:\n${stderr}`);
});

Deno.test("config: a WEEKLY_AVAILABILITY 24:00 with minutes is named by position, value-free", async () => {
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    WEEKLY_AVAILABILITY: "MON 09:00-17:00, TUE 09:00-24:30",
  });
  assertEquals(code, 1);
  assertStringIncludes(
    stderr,
    "WEEKLY_AVAILABILITY: entry 2: 24:00 must be exact, no other minutes allowed",
  );
  assertEquals(stderr.includes("24:30"), false, `stderr echoed:\n${stderr}`);
});

Deno.test("config: a WEEKLY_AVAILABILITY backwards day range is named by position, value-free", async () => {
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    WEEKLY_AVAILABILITY: "MON 09:00-17:00, FRI-MON 09:00-17:00",
  });
  assertEquals(code, 1);
  assertStringIncludes(
    stderr,
    "WEEKLY_AVAILABILITY: entry 2: day range goes backwards",
  );
});

// Pins the mig#38 round 2 wording ("must be after", not "is before") and
// the equal-times boundary from the issue's own example (09:00-09:00).
Deno.test("config: a WEEKLY_AVAILABILITY end time not after start is named by position, value-free", async () => {
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    WEEKLY_AVAILABILITY: "MON 09:00-17:00, TUE 09:00-09:00",
  });
  assertEquals(code, 1);
  assertStringIncludes(
    stderr,
    "WEEKLY_AVAILABILITY: entry 2: end time must be after start time",
  );
});

for (
  const [label, value] of [
    ["bad date", "2026-12-24,MARKER-e5not-a-date,2026-12-26"],
    ["bad range", "2026-12-24,2026-12-24..MARKER-f6..2026-12-26,2026-12-27"],
  ] as const
) {
  Deno.test(`config: a BLOCKED_DATES entry 2 with ${label} is named by position, not echoed`, async () => {
    const { code, stderr } = await runConfig({
      ...VALID_ENV,
      BLOCKED_DATES: value,
    });
    assertEquals(code, 1);
    assertStringIncludes(stderr, "BLOCKED_DATES");
    assertStringIncludes(stderr, "entry 2");
    assertEquals(
      /MARKER-[a-f]\d/.test(stderr),
      false,
      `stderr echoed the bad value:\n${stderr}`,
    );
  });
}

// Reaches parseSingleDate's own message (called from inside a ".." range)
// rather than parseDateToken's generic fallback the two cases above hit —
// a distinct code path, unlike the previous round's tests which (despite
// their different labels) all funneled into the same message.
Deno.test("config: a BLOCKED_DATES malformed date inside a range is named by position, not echoed", async () => {
  const marker = "MARKER-QDATE-g7";
  const { code, stderr } = await runConfig({
    ...VALID_ENV,
    BLOCKED_DATES: `2026-12-24,2026-12-24..${marker},2026-12-27`,
  });
  assertEquals(code, 1);
  assertStringIncludes(
    stderr,
    "BLOCKED_DATES: entry 2: invalid, expected YYYY-MM-DD or DD.MM.YYYY",
  );
  assertRawValueNotLeaked(stderr, marker);
});
