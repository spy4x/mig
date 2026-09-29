/*
  TimeCard — compact summary of the selected time slot.

  Shown in place of the full TimeSlots grid once a slot is picked.
  Same visual contract as DateCard so the swap reads as a deliberate
  progression, not a state change.
*/

import { IconArrowRight, IconClock } from "@spy4x/preact-icons";
import { pickerHref } from "../lib/picker-links.ts";

interface TimeCardProps {
  date: string; // YYYY-MM-DD (host-local)
  slot: string; // HH:MM in host TZ
  dateLabel: string; // "Friday, 28 August 2026"
  /** Optional override for the displayed slot time (e.g. visitor-TZ
   *  HH:MM). Falls back to `slot` (host TZ) when omitted. The `slot`
   *  prop stays the source of truth for the URL / POST body. */
  displaySlot?: string;
  /** Called when the Change link is clicked. When provided, Change is
   *  a <button>; otherwise it stays an <a href> for the no-JS /
   *  /embed fallback, built from `basePath`. */
  onClear?: () => void;
  /** "" for the standalone page, "/embed" for the iframe variant.
   *  Defaults to "". */
  basePath?: string;
  /** The visitor's IANA zone, once known (mig#15) — threaded onto the
   *  Change link so /embed's tz query param survives. */
  tz?: string | null;
  /** /embed's forced theme, once known (mig#44) — threaded onto the
   *  Change link so /embed's theme query param survives. `null` for
   *  "auto" (the default), which adds nothing to the link. */
  theme?: string | null;
}

export function TimeCard(
  { date, slot, dateLabel, displaySlot, onClear, basePath = "", tz, theme }:
    TimeCardProps,
) {
  const shownSlot = displaySlot ?? slot;
  // Focus styles live on the outer <button>/<a> — same reason as
  // DateCard: the inner <span> never receives focus.
  const changeClass =
    "shrink-0 inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-brand-600 dark:hover:text-brand-300 transition-colors focus:outline-none focus-visible:underline";

  return (
    <div class="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
      <div class="flex items-center gap-3 min-w-0">
        <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <IconClock class="size-4" />
        </span>
        <div class="min-w-0">
          <p class="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
            Time
          </p>
          <p class="text-sm font-medium text-ink truncate tnum">
            {shownSlot}{" "}
            <span class="text-ink-subtle font-normal">· {dateLabel}</span>
          </p>
        </div>
      </div>
      {onClear
        ? (
          <button
            type="button"
            onClick={onClear}
            aria-label="Change time"
            class={changeClass}
          >
            Change
            <IconArrowRight class="size-3" />
          </button>
        )
        : (
          <a
            href={pickerHref(basePath, { date }, tz, theme)}
            // Fresh would mark this link to the page's own path as
            // current (mig#50, see SlotButton in TimeSlots.tsx).
            aria-current="false"
            aria-label="Change time"
            class={changeClass}
          >
            Change
            <IconArrowRight class="size-3" />
          </a>
        )}
    </div>
  );
}
