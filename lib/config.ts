// Environment variable parsing + Zod validation.
// All required vars cause the process to exit 1 if missing/malformed.

import { z } from "zod";
import { parseWeeklyAvailability } from "./availability.ts";
import { parseBlockedDates } from "./availability.ts";
import type { Config } from "./types.ts";

const Required = z.string().min(1, "required");

const RawSchema = z.object({
  HOST_NAME: Required,
  HOST_EMAIL: Required.email(),
  HOST_TZ: Required,
  MEETING_URL: Required.url(),
  PUBLIC_URL: Required.url(),
  WEEKLY_AVAILABILITY: Required,
  SLOT_DURATION_MIN: z.coerce.number().int().positive().max(480),
  MIN_NOTICE_HOURS: z.coerce.number().int().nonnegative().default(6),
  BOOKING_HORIZON_DAYS: z.coerce.number().int().positive().max(365).default(14),
  BLOCKED_DATES: z.string().optional().default(""),
  RATE_LIMIT_PER_5MIN: z.coerce.number().int().positive().default(1),
  THEME: z.enum(["light", "dark", "auto"]).default("auto"),
  SMTP_HOST: Required,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: Required,
  SMTP_PASS: Required,
  SMTP_FROM: Required,
  CANCEL_SECRET: Required.min(16, "min 16 chars"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATA_PATH: z.string().default("./data/bookings.json"),
  HIDE_BRANDING: z.coerce.boolean().default(false),
  GITHUB_URL: z.string().url().default("https://github.com/spy4x/mig"),
});

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
  const raw = RawSchema.safeParse(env);
  if (!raw.success) {
    const issues = raw.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`mig: invalid environment configuration:\n${issues}`);
    Deno.exit(1);
  }
  const r = raw.data;

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
      pass: r.SMTP_PASS,
      from: r.SMTP_FROM,
    },
    cancelSecret: r.CANCEL_SECRET,
    port: r.PORT,
    dataPath: r.DATA_PATH,
    hideBranding: r.HIDE_BRANDING,
    githubUrl: r.GITHUB_URL,
  };
}

export const config: Config = parseConfig();
