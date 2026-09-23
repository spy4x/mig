// Environment variable parsing + arktype validation.
// All required vars cause the process to exit 1 if missing/malformed.

import { type } from "arktype";
import { parseWeeklyAvailability } from "./availability.ts";
import { parseBlockedDates } from "./availability.ts";
import { Email } from "./email-pattern.ts";
import type { Config } from "./types.ts";

// Field-level shape + constraints, applied to the already-defaulted/
// coerced candidate built below. A field with a `.default()` in the
// old Zod schema gets its default substituted here *before* this
// schema ever sees it (see `withDefault`), so this only needs to
// describe what a *provided* value must look like — every default
// below also happens to satisfy its own constraint, so running it
// through the schema unconditionally is safe.
const ConfigSchema = type({
  HOST_NAME: "string > 0",
  HOST_EMAIL: Email,
  HOST_TZ: "string > 0",
  MEETING_URL: "string.url",
  PUBLIC_URL: "string.url",
  WEEKLY_AVAILABILITY: "string > 0",
  SLOT_DURATION_MIN: "1 <= number.integer <= 480",
  MIN_NOTICE_HOURS: "number.integer >= 0",
  BOOKING_HORIZON_DAYS: "1 <= number.integer <= 365",
  BLOCKED_DATES: "string",
  RATE_LIMIT_PER_5MIN: "number.integer > 0",
  THEME: "'light' | 'dark' | 'auto'",
  SMTP_HOST: "string > 0",
  SMTP_PORT: "number.integer > 0",
  SMTP_USER: "string > 0",
  // Homelab convention is SMTP_PASSWORD (matches servers/{cloud,home}/.env).
  SMTP_PASSWORD: "string > 0",
  SMTP_FROM: "string > 0",
  CANCEL_SECRET: "string >= 16",
  PORT: "number.integer > 0",
  DATA_PATH: "string",
  HIDE_BRANDING: "boolean",
  GITHUB_URL: "string.url",
  // Build identifier. Injected at container build time as a docker
  // --build-arg (see AGENTS.md "Build version"). Defaults to "dev" so
  // local `deno task dev` always shows something sensible.
  MIG_VERSION: "string <= 64",
});

/** Mirrors Zod's `.default(x)`: use `defaultValue` untouched when the
 *  key is absent from `env`; otherwise run the raw string through
 *  `coerce` — the same "coerce, don't validate here" split
 *  `z.coerce.number()`/`z.coerce.boolean()` had. */
function withDefault<T>(
  env: Record<string, string>,
  key: string,
  defaultValue: T,
  coerce: (raw: string) => T,
): T {
  return key in env ? coerce(env[key]) : defaultValue;
}

const identity = (raw: string): string => raw;

function loadEnv(): Record<string, string> {
  // Load .env if present; in production env is set by container.
  try {
    const text = Deno.readTextFileSync(".env");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in Deno.env.toObject())) {
        Deno.env.set(key, value);
      }
    }
  } catch {
    // .env not present; rely on real env vars
  }
  return Deno.env.toObject();
}

function parseConfig(): Config {
  const env = loadEnv();

  // Required vars (no default in the old schema): pass the raw string
  // straight through, undefined and all — ConfigSchema rejects a
  // missing/empty one with a message naming the variable.
  // Optional vars (had a `.default()`): substitute the default when
  // the key is absent, coerce the raw string when it's present —
  // z.coerce.number()/boolean() were literally `Number(x)`/`Boolean(x)`,
  // so that's what `Number`/`Boolean` below reproduce, warts (e.g.
  // `Boolean("false") === true`) and all.
  const candidate = {
    HOST_NAME: env.HOST_NAME,
    HOST_EMAIL: env.HOST_EMAIL,
    HOST_TZ: env.HOST_TZ,
    MEETING_URL: env.MEETING_URL,
    PUBLIC_URL: env.PUBLIC_URL,
    WEEKLY_AVAILABILITY: env.WEEKLY_AVAILABILITY,
    SLOT_DURATION_MIN: Number(env.SLOT_DURATION_MIN),
    MIN_NOTICE_HOURS: withDefault(env, "MIN_NOTICE_HOURS", 6, Number),
    BOOKING_HORIZON_DAYS: withDefault(env, "BOOKING_HORIZON_DAYS", 14, Number),
    BLOCKED_DATES: withDefault(env, "BLOCKED_DATES", "", identity),
    RATE_LIMIT_PER_5MIN: withDefault(env, "RATE_LIMIT_PER_5MIN", 1, Number),
    THEME: withDefault(env, "THEME", "auto", identity),
    SMTP_HOST: env.SMTP_HOST,
    SMTP_PORT: withDefault(env, "SMTP_PORT", 587, Number),
    SMTP_USER: env.SMTP_USER,
    SMTP_PASSWORD: env.SMTP_PASSWORD,
    SMTP_FROM: env.SMTP_FROM,
    CANCEL_SECRET: env.CANCEL_SECRET,
    PORT: withDefault(env, "PORT", 8080, Number),
    DATA_PATH: withDefault(env, "DATA_PATH", "./data/bookings.json", identity),
    HIDE_BRANDING: withDefault(env, "HIDE_BRANDING", false, Boolean),
    GITHUB_URL: withDefault(
      env,
      "GITHUB_URL",
      "https://github.com/spy4x/mig",
      identity,
    ),
    MIG_VERSION: withDefault(
      env,
      "MIG_VERSION",
      "dev",
      (raw) => raw.trim(),
    ),
  };

  const validated = ConfigSchema(candidate);
  if (validated instanceof type.errors) {
    // arktype's default messages end with `(was <the actual value>)` —
    // fine for a length count ("was 5") but not for a type/pattern
    // mismatch, where <the actual value> is the raw env string itself
    // (e.g. a malformed MEETING_URL carrying a query-string token).
    // Startup errors go to the container's logs, so name the variable
    // and the reason, never the value.
    const issues = [...validated]
      .map((issue) => {
        const message = issue.message.replace(/ \(was .*\)$/, "");
        return `  ${issue.path.join(".")}: ${message}`;
      })
      .join("\n");
    console.error(`mig: invalid environment configuration:\n${issues}`);
    Deno.exit(1);
  }
  const r = validated;

  // Parse availability + blocked dates (throw on bad syntax)
  let availability;
  try {
    availability = parseWeeklyAvailability(r.WEEKLY_AVAILABILITY);
  } catch (e) {
    console.error(`mig: WEEKLY_AVAILABILITY: ${(e as Error).message}`);
    Deno.exit(1);
  }

  let blockedDates: Set<string>;
  try {
    blockedDates = parseBlockedDates(r.BLOCKED_DATES, r.HOST_TZ);
  } catch (e) {
    console.error(`mig: BLOCKED_DATES: ${(e as Error).message}`);
    Deno.exit(1);
  }

  // IANA tz sanity check (Intl.DateTimeFormat throws on invalid)
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: r.HOST_TZ });
  } catch {
    console.error(`mig: HOST_TZ="${r.HOST_TZ}" is not a valid IANA timezone`);
    Deno.exit(1);
  }

  return {
    hostName: r.HOST_NAME,
    hostEmail: r.HOST_EMAIL,
    hostTz: r.HOST_TZ,
    meetingUrl: r.MEETING_URL,
    publicUrl: r.PUBLIC_URL.replace(/\/$/, ""),
    weeklyAvailability: availability,
    slotDurationMin: r.SLOT_DURATION_MIN,
    minNoticeHours: r.MIN_NOTICE_HOURS,
    bookingHorizonDays: r.BOOKING_HORIZON_DAYS,
    blockedDates,
    rateLimitPer5Min: r.RATE_LIMIT_PER_5MIN,
    theme: r.THEME,
    smtp: {
      host: r.SMTP_HOST,
      port: r.SMTP_PORT,
      user: r.SMTP_USER,
      pass: r.SMTP_PASSWORD,
      from: r.SMTP_FROM,
    },
    cancelSecret: r.CANCEL_SECRET,
    port: r.PORT,
    dataPath: r.DATA_PATH,
    hideBranding: r.HIDE_BRANDING,
    githubUrl: r.GITHUB_URL,
    version: r.MIG_VERSION,
  };
}

export const config: Config = parseConfig();
