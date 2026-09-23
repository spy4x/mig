// lib/config.ts exits the process on invalid env (Deno.exit(1)), which a
// same-process test can't observe without killing the test runner itself —
// so these run it in a child process, the same shape as the boot check in
// the PR description, and assert on its exit code + stderr.

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
 *  coercion result), not just "did it exit 0". */
async function runConfigField(
  env: Record<string, string>,
  field: string,
): Promise<string> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      "--allow-env",
      "--allow-read",
      `const { config } = await import(\`file://\${Deno.cwd()}/lib/config.ts\`); console.log(config.${field})`,
    ],
    cwd: Deno.cwd(),
    env,
    clearEnv: true,
    stdout: "piped",
    stderr: "inherit",
  });
  const { stdout } = await command.output();
  return new TextDecoder().decode(stdout).trim();
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
  assertEquals(value, "6");
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
