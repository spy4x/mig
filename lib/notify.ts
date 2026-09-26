// Optional NTFY notifier. Pushes are gated by NTFY_MODE:
//
//   all     (default) → push on booking success, cancellation, email fail
//   errors            → push only on email-send failures
//   booking           → push only on successful bookings
//   cancel            → push only on cancellations
//
// NTFY_URL + NTFY_TOPIC must both be set to enable the notifier at all;
// NTFY_TOKEN is optional (an ntfy without auth needs none). The client
// is @spy4x/integrations' NtfyClient: the title and tags are sent as
// ASCII headers, the body as UTF-8, and a 429, a 5xx or a network error
// is retried. Pushes are fail-soft: a failure is logged but doesn't
// affect the user-facing flow.

import {
  NotificationSeverity,
  NtfyClient,
  type NtfyClientOptions,
  ntfyConfigFromEnv,
  type NtfyPriority,
  type NtfyRetryOptions,
} from "@spy4x/integrations/ntfy";
import type { Config } from "./types.ts";
import type { Booking } from "./types.ts";
import { formatClockShortAt, formatOwnerClock } from "./clock.ts";

export type NtfyMode = "all" | "errors" | "booking" | "cancel";

interface NotifyOpts {
  title: string;
  message: string;
  priority?: NtfyPriority;
  tags?: string[];
  severity: NotificationSeverity;
}

// The booking and cancel handlers await the push before they answer
// the visitor, so a slow or failing ntfy must not hold a request for
// the client's default minute. Three attempts within five seconds.
const NTFY_RETRY: NtfyRetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 2_000,
  totalBudgetMs: 5_000,
};
const NTFY_REQUEST_TIMEOUT_MS = 3_000;

let clientOptionsForTesting: NtfyClientOptions = {};

/** Test-only seam: extra NtfyClient options (a fake `sleep`, say) for
 *  every push until called again with `{}`. Never call this outside a
 *  test. */
export function setNtfyClientOptionsForTesting(
  options: NtfyClientOptions,
): void {
  clientOptionsForTesting = options;
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

async function notify(opts: NotifyOpts): Promise<void> {
  const settings = ntfyConfigFromEnv();
  if (settings === null) return;
  let client: NtfyClient;
  try {
    client = new NtfyClient(settings, {
      retry: NTFY_RETRY,
      requestTimeoutMs: NTFY_REQUEST_TIMEOUT_MS,
      // NTFY_MODE above is mig's gate; the client's own gate lets
      // every severity through.
      gate: NotificationSeverity.Info,
      ...clientOptionsForTesting,
    });
  } catch (e) {
    // A malformed NTFY_URL. The message names the shape, never the value.
    console.error(`mig: ntfy is misconfigured: ${(e as Error).message}`);
    return;
  }
  const result = await client.push(opts);
  if (!result.ok) {
    console.error(
      `mig: ntfy notify failed (${client.endpoint}): ${result.message} ` +
        `after ${result.attempts} attempt(s)`,
    );
  }
}

// ─── Event-specific helpers ───────────────────────────────────────────

// Owner-facing "When:" line for a push notification — the host's own
// dated clock, plus the visitor's clock (and date, if it differs)
// alongside it whenever a valid visitor zone was captured (mig#15: the
// owner always sees where the visitor is, not just the host's own
// time). Falls back to the host clock alone when no visitor zone is
// known. Delegates to lib/clock.ts's formatOwnerClock — the same helper
// the owner's email uses — so the two can't drift.
function ownerWhenLabel(booking: Booking): string {
  return formatOwnerClock(
    booking.date,
    booking.time,
    booking.hostTz,
    booking.guestTz,
  );
}

export function notifyBookingSucceeded(
  config: Config,
  booking: Booking,
): Promise<void> {
  if (!isEventEnabled("booking")) return Promise.resolve();
  return notify({
    severity: NotificationSeverity.Info,
    title: `mig: new booking - ${booking.guestName}`,
    message: [
      `mig: ${config.hostName} got a new booking.`,
      "",
      `Guest:  ${booking.guestName} <${booking.guestEmail}>`,
      `When:   ${ownerWhenLabel(booking)}`,
      `Notes:  ${booking.notes?.trim() || "(none)"}`,
      `Booked: ${
        formatClockShortAt(new Date(booking.createdAt), config.hostTz)
      }`,
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
  return notify({
    severity: NotificationSeverity.Info,
    title: `mig: cancelled by ${cancelledBy} - ${booking.guestName}`,
    message: [
      `mig: ${config.hostName}'s booking was cancelled.`,
      "",
      `Cancelled by: ${cancellerLabel}`,
      `When:    ${ownerWhenLabel(booking)}`,
      `Guest:   ${booking.guestName} <${booking.guestEmail}>`,
      `Reason:  ${reason?.trim() || "(none)"}`,
      `At:      ${formatClockShortAt(new Date(), config.hostTz)}`,
    ].join("\n"),
    priority: 3,
    tags: ["mig", "cancel"],
  });
}

export interface EmailFailedOpts {
  /** Whether the post-send-failure rollback actually removed the
   *  booking. Required — no default. A silent "assume success"
   *  default would repeat the exact bug this option exists to fix: a
   *  caller that forgets to check the rollback's own outcome would
   *  get the same false "removed, slot free again" text that shipped
   *  before this option existed. False means the rollback's own disk
   *  write also failed — BookingsStore.mutate() (lib/bookings.ts)
   *  assigns its in-memory array before it awaits the write, so the
   *  in-memory removal still held, but the booking may still be on
   *  disk and would come back after a restart. The push must not
   *  claim it was removed or that the slot is free in that case. */
  rolledBack: boolean;
}

// mig#19 review round 3: the previous wording ("booking confirmation
// email failed to send") only described the failure, not its
// outcome — a host skimming a phone push could easily read it as "an
// email is late" rather than "there is no booking". lib/book.ts
// rolls the booking back on any send failure here, so the push must
// say what actually happened: removed and the slot is free again when
// the rollback succeeded, or — when the rollback's own write also
// failed — that the booking may still be on disk and needs removing
// by hand. The rollback-failed wording says "an email failed to
// send", not "the confirmation email" specifically: the failure can
// be the owner's own "New booking" email (sent first in lib/book.ts),
// not only the guest's confirmation, and the `Error:` line below
// already carries the detail.
export function notifyBookingEmailFailed(
  config: Config,
  booking: Booking,
  error: string,
  opts: EmailFailedOpts,
): Promise<void> {
  if (!isEventEnabled("error")) return Promise.resolve();
  const { rolledBack } = opts;
  const lines = [
    rolledBack
      ? `mig: a booking for ${booking.guestName} was NOT created — the ` +
        `confirmation email failed, so it was removed and the slot is ` +
        `free again`
      : `mig: a booking for ${booking.guestName} was NOT confirmed — ` +
        `an email failed to send, and removing the booking failed too. ` +
        `It may still be on disk and come back after a restart. ` +
        `Remove it by hand: id ${booking.id} in the data file.`,
    "",
    `Error: ${error}`,
    "",
    `Guest:  ${booking.guestName} <${booking.guestEmail}>`,
    `When:   ${ownerWhenLabel(booking)}`,
    `Notes:  ${booking.notes?.trim() || "(none)"}`,
    `Booked: ${formatClockShortAt(new Date(booking.createdAt), config.hostTz)}`,
  ];
  return notify({
    severity: NotificationSeverity.Failure,
    title: rolledBack
      ? `mig: NOT booked - ${booking.guestName}`
      : `mig: NOT booked, remove by hand - ${booking.guestName}`,
    message: lines.join("\n"),
    priority: rolledBack ? 4 : 5,
    tags: rolledBack
      ? ["mig", "email-failed", "warning"]
      : ["mig", "email-failed", "rollback-failed", "warning"],
  });
}
