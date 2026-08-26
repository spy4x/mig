// Optional NTFY notifier. When configured (NTFY_URL + NTFY_TOPIC +
// NTFY_TOKEN), any email-send failure posts a notification to the
// topic with the booking context. Fail-soft: if NTFY itself errors,
// we log and move on — it's a notification channel, not a critical
// path.

import type { Config } from "./types.ts";
import type { Booking } from "./types.ts";

export interface NotifyOpts {
  title: string;
  message: string;
  priority?: 1 | 2 | 3 | 4 | 5; // 1=min, 5=max; ntfy uses the same scale
  tags?: string[];
  click?: string;
}

export interface NtfyConfig {
  url: string;
  topic: string;
  token: string;
}

export function ntfyConfigFromEnv(config: Config): NtfyConfig | null {
  // Pulled from process env (config doesn't carry these — they're
  // optional and live in a separate channel from the core SMTP
  // config so a misconfigured NTFY doesn't break startup).
  const url = Deno.env.get("NTFY_URL")?.trim();
  const topic = Deno.env.get("NTFY_TOPIC")?.trim();
  const token = Deno.env.get("NTFY_TOKEN")?.trim();
  if (!url || !topic || !token) return null;
  return { url: url.replace(/\/+$/, ""), topic, token };
}

function isNtfyEnabled(n: NtfyConfig | null): n is NtfyConfig {
  return n !== null;
}

export async function notify(
  config: Config,
  opts: NotifyOpts,
): Promise<void> {
  const n = ntfyConfigFromEnv(config);
  if (!isNtfyEnabled(n)) return;
  const url = `${n.url}/${encodeURIComponent(n.topic)}`;
  const headers: Record<string, string> = {
    "Title": opts.title,
    "Authorization": `Bearer ${n.token}`,
  };
  if (opts.priority) headers["Priority"] = String(opts.priority);
  if (opts.tags?.length) headers["Tags"] = opts.tags.join(",");
  if (opts.click) headers["Click"] = opts.click;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: opts.message,
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

// Convenience: build the standard booking-email-failed payload.
export function notifyBookingEmailFailed(
  config: Config,
  booking: Booking | null,
  error: string,
): Promise<void> {
  const lines = [
    booking
      ? `mig: ${config.hostName}'s booking confirmation email failed to send`
      : "mig: booking email send failed (no booking record — transactional rollback)",
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
