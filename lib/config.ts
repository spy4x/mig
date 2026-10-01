// Environment variable parsing + arktype validation.
// All required vars cause the process to exit 1 if missing/malformed.

import { type Type, type } from "arktype";
import { parseWeeklyAvailability } from "./availability.ts";
import { parseBlockedDates } from "./availability.ts";
import { emailAddress } from "@spy4x/platform/validation/predicates";
import { ConfigError, loadConfig } from "@spy4x/server/config";
import { formatConfigIssues } from "./config-issue.ts";
import { parseAddress } from "@spy4x/email/address";
import { MIN_SECRET_LENGTH } from "@spy4x/platform/tokens";
import type { Config } from "./types.ts";

// @spy4x/platform/tokens refuses a secret that is shorter than 32
// characters once trimmed, or that holds anything but printable ASCII —
// and it refuses at the first booking, not at startup. Checked here with
// the same rule, so a bad CANCEL_SECRET stops the process instead.
const CancelSecret = type("string").narrow((value) => {
  const trimmed = value.trim();
  return trimmed.length >= MIN_SECRET_LENGTH && /^[\x20-\x7e]+$/.test(trimmed);
});

// The SMTP sender parses SMTP_FROM on every send and refuses a
// malformed mailbox or a control character (a CR or LF in the display
// name would inject a header). Checked here with the same parser.
const SmtpFrom = type("string").narrow((value) => {
  try {
    parseAddress(value);
    return true;
  } catch {
    return false;
  }
});

// A variable read from the environment as a string, converted by `parse`
// and then checked against `rule`. `Number` is what `z.coerce.number()`
// was, and a malformed number (NaN) fails the integer rule.
const converted = <const rule extends Type>(
  parse: (raw: string) => unknown,
  rule: rule,
) => type("string").pipe(parse, rule);

const toNumber = (raw: string): number => Number(raw);

// mig#59: the one proxy header the rate limiter reads the client's
// address from. Empty (the default) trusts no header: the limiter keys on
// the socket address alone, which a client cannot forge. Header names are
// case-insensitive, so `CF-Connecting-IP` as the operator copies it from
// a proxy's docs is accepted too.
const toProxyHeader = (raw: string): string => raw.trim().toLowerCase();

// mig#35: z.coerce.boolean()/Boolean(raw) turned any non-empty string,
// including "false" and "0", into true. This coerces case-insensitively
// and trims first (whitespace-only counts as empty), and leaves anything
// else as the raw string so the schema's `"boolean"` check rejects it.
function toHideBranding(raw: string): boolean | string {
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no" || v === "") return false;
  return raw;
}

// The environment schema, read through @spy4x/server's `loadConfig`: every
// variable arrives as a string, a blank one counts as unset, and a
// variable with a default takes it when unset. Required ones have none.
const ConfigSchema = type({
  HOST_NAME: "string > 0",
  HOST_EMAIL: emailAddress,
  HOST_TZ: "string > 0",
  MEETING_URL: "string.url",
  PUBLIC_URL: "string.url",
  WEEKLY_AVAILABILITY: "string > 0",
  SLOT_DURATION_MIN: converted(toNumber, type("1 <= number.integer <= 480")),
  MIN_NOTICE_HOURS: converted(toNumber, type("number.integer >= 0")),
  BOOKING_HORIZON_DAYS: converted(
    toNumber,
    type("1 <= number.integer <= 365"),
  ),
  BLOCKED_DATES: "string",
  RATE_LIMIT_PER_5MIN: converted(toNumber, type("number.integer > 0")),
  TRUSTED_PROXY_HEADER: converted(
    toProxyHeader,
    type("'' | 'cf-connecting-ip' | 'x-forwarded-for' | 'x-real-ip'"),
  ),
  THEME: "'light' | 'dark' | 'auto'",
  SMTP_HOST: "string > 0",
  SMTP_PORT: converted(toNumber, type("number.integer > 0")),
  SMTP_USER: "string > 0",
  // Homelab convention is SMTP_PASSWORD (matches servers/{cloud,home}/.env).
  SMTP_PASSWORD: "string > 0",
  SMTP_FROM: SmtpFrom,
  CANCEL_SECRET: CancelSecret,
  PORT: converted(toNumber, type("number.integer > 0")),
  DATA_PATH: "string",
  HIDE_BRANDING: converted(toHideBranding, type("boolean")),
  GITHUB_URL: "string.url",
  MIG_VERSION: converted((raw) => raw.trim(), type("string <= 64")),
});

// What a variable is when the operator leaves it unset or blank. The
// required variables (no entry here) fail as "is missing" instead.
const DEFAULTS: Record<string, string> = {
  MIN_NOTICE_HOURS: "6",
  BOOKING_HORIZON_DAYS: "14",
  BLOCKED_DATES: "",
  RATE_LIMIT_PER_5MIN: "1",
  TRUSTED_PROXY_HEADER: "",
  THEME: "auto",
  SMTP_PORT: "587",
  PORT: "8080",
  DATA_PATH: "./data/bookings.json",
  HIDE_BRANDING: "false",
  GITHUB_URL: "https://github.com/spy4x/mig",
  // Build identifier. Injected at container build time as a docker
  // --build-arg (see AGENTS.md "Build version"). Defaults to "dev" so
  // local `deno task dev` always shows something sensible.
  MIG_VERSION: "dev",
};

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

  let r;
  try {
    r = loadConfig(ConfigSchema, {
      get: (name) =>
        (env[name] ?? "").trim() === "" ? DEFAULTS[name] : env[name],
    });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    // ConfigError.issues carry a reason per variable and never a value;
    // formatConfigIssues only swaps in mig's own wording where it is
    // clearer. Never print arktype's own message: it echoes the value.
    console.error(
      `mig: invalid environment configuration:\n${
        formatConfigIssues(e.issues)
      }`,
    );
    Deno.exit(1);
  }

  // IANA tz sanity check (Intl.DateTimeFormat throws on invalid). Validated
  // before BLOCKED_DATES below: parseBlockedDates needs r.HOST_TZ to expand
  // date ranges, so an invalid timezone must fail here with its own message
  // rather than surface as a confusing BLOCKED_DATES failure.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: r.HOST_TZ });
  } catch {
    console.error("mig: HOST_TZ: is not a valid IANA time zone");
    Deno.exit(1);
  }

  // Parse availability + blocked dates (throw on bad syntax). Both throw a
  // ConfigSyntaxError (lib/availability.ts) whose `.message` already names
  // the entry's position and a value-free reason — never the raw value.
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
    trustedProxyHeader: r.TRUSTED_PROXY_HEADER === ""
      ? undefined
      : r.TRUSTED_PROXY_HEADER,
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
