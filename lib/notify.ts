// Optional NTFY notifier. Pushes are gated by NTFY_MODE:
//
//   all     (default) → push on booking success, cancellation, email fail
//   errors            → push only on email-send failures
//   booking           → push only on successful bookings
//   cancel            → push only on cancellations
//
// All three of NTFY_URL + NTFY_TOPIC + NTFY_TOKEN must be set to
// enable the notifier at all; missing any = no-op regardless of mode.
// Pushes are fail-soft: a transport error is logged but doesn't
// affect the user-facing flow.

import type { Config } from "./types.ts";
import type { Booking } from "./types.ts";

export type NtfyMode = "all" | "errors" | "booking" | "cancel";

export interface NotifyOpts {
  title: string;
  message: string;
  priority?: 1 | 2 | 3 | 4 | 5;
  tags?: string[];
  click?: string;
}

export interface NtfyConfig {
  url: string;
  topic: string;
  token: string;
}

export function ntfyConfigFromEnv(_config: Config): NtfyConfig | null {
  const url = Deno.env.get("NTFY_URL")?.trim();
  const topic = Deno.env.get("NTFY_TOPIC")?.trim();
  const token = Deno.env.get("NTFY_TOKEN")?.trim();
  if (!url || !topic || !token) return null;
  return { url: url.replace(/\/+$/, ""), topic, token };
}

function isNtfyEnabled(n: NtfyConfig | null): n is NtfyConfig {
  return n !== null;
}

function ntfyMode(): NtfyMode {
  const v = Deno.env.get("NTFY_MODE")?.trim().toLowerCase();
  if (v === "errors" || v === "booking" || v === "cancel") return v;
  return "all";
}

function isEventEnabled(event: "booking" | "cancel" | "error"): boolean {
  const mode = ntfyMode();
  if (mode === "all") return true;
  if (mode === "errors" && event === "error") return true;
  if (mode === "booking" && event === "booking") return true;
  if (mode === "cancel" && event === "cancel") return true;
  return false;
}

export async function notify(
  config: Config,
  opts: NotifyOpts,
): Promise<void> {
  const n = ntfyConfigFromEnv(config);
  if (!isNtfyEnabled(n)) return;
  const url = `${n.url}/${encodeURIComponent(n.topic)}`;
  // NTFY only accepts HTTP-header-safe characters (per the WHATWG
  // Headers spec), so strip / replace non-ASCII before setting
  // them. Whitespace (LF, CR, TAB) is preserved so multi-line
  // message bodies stay readable. Use a Headers instance so any
  // failure throws a clear scoped error here instead of "Request
  // constructor: headers is not a valid ByteString" from the
  // fetch internals.
  const safe = (s: string): string =>
    // deno-lint-ignore no-control-regex
    s.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, (c) => {
      // Map common non-ASCII punctuation to ASCII fallbacks so
      // titles still read well ("mig: cancelled by guest - Bob"
      // not "mig: cancelled by guest ? Bob").
      switch (c) {
        case "—":
        case "–":
        case "‐":
        case "−":
          return "-";
        case "‘":
        case "’":
        case "‚":
        case "‛":
          return "'";
        case "“":
        case "”":
        case "„":
        case "‟":
          return '"';
        case "…":
          return "...";
        case " ":
          return " ";
        default:
          return "?";
      }
    });
  const headers = new Headers();
  headers.set("Title", safe(opts.title));
  headers.set("Authorization", `Bearer ${n.token}`);
  if (opts.priority !== undefined) {
    headers.set("Priority", String(opts.priority));
  }
  if (opts.tags && opts.tags.length > 0) {
    headers.set("Tags", safe(opts.tags.join(",")));
  }
  if (opts.click) {
    headers.set("Click", opts.click);
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: safe(opts.message),
    });
    if (!res.ok) {
      console.error(
        `mig: ntfy notify failed (${url}): ${res.status} ${res.statusText}`,
      );
    }
  } catch (e) {
    console.error(`mig: ntfy notify error: ${(e as Error).message}`);
  }
}

// ─── Event-specific helpers ───────────────────────────────────────────

export function notifyBookingSucceeded(
  config: Config,
  booking: Booking,
): Promise<void> {
  if (!isEventEnabled("booking")) return Promise.resolve();
  return notify(config, {
    title: `mig: new booking - ${booking.guestName}`,
    message: [
      `mig: ${config.hostName} got a new booking.`,
      "",
      `Guest:  ${booking.guestName} <${booking.guestEmail}>`,
      `When:   ${booking.date} ${booking.time} (${booking.hostTz})`,
      `Notes:  ${booking.notes?.trim() || "(none)"}`,
      `Booked: ${booking.createdAt}`,
    ].join("\n"),
    priority: 3,
    tags: ["mig", "booking"],
  });
}

export function notifyBookingCancelled(
  config: Config,
  booking: Booking,
  cancelledBy: "owner" | "guest",
  reason: string | undefined,
): Promise<void> {
  if (!isEventEnabled("cancel")) return Promise.resolve();
  const cancellerLabel = cancelledBy === "guest"
    ? `${booking.guestName} <${booking.guestEmail}>`
    : `${config.hostName}`;
  return notify(config, {
    title: `mig: cancelled by ${cancelledBy} - ${booking.guestName}`,
    message: [
      `mig: ${config.hostName}'s booking was cancelled.`,
      "",
      `Cancelled by: ${cancellerLabel}`,
      `When:    ${booking.date} ${booking.time} (${booking.hostTz})`,
      `Guest:   ${booking.guestName} <${booking.guestEmail}>`,
      `Reason:  ${reason?.trim() || "(none)"}`,
      `At:      ${new Date().toISOString()}`,
    ].join("\n"),
    priority: 3,
    tags: ["mig", "cancel"],
  });
}

export function notifyBookingEmailFailed(
  config: Config,
  booking: Booking | null,
  error: string,
): Promise<void> {
  if (!isEventEnabled("error")) return Promise.resolve();
  const lines = [
    booking
      ? `mig: ${config.hostName}'s booking confirmation email failed to send`
      : "mig: booking email send failed (no booking record - transactional rollback)",
    "",
    `Error: ${error}`,
  ];
  if (booking) {
    lines.push(
      "",
      `Guest:  ${booking.guestName} <${booking.guestEmail}>`,
      `When:   ${booking.date} ${booking.time} (${booking.hostTz})`,
      `Notes:  ${booking.notes?.trim() || "(none)"}`,
      `Booked: ${booking.createdAt}`,
    );
  }
  return notify(config, {
    title: booking
      ? `mig: email failed for ${booking.guestName}`
      : "mig: email failed",
    message: lines.join("\n"),
    priority: 4,
    tags: ["mig", "email-failed", "warning"],
  });
}
