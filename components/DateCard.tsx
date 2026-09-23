/*
  DateCard — compact summary of the selected date.

  Shown in place of the full Calendar once a date is picked. Mirrors
  the calendar's visual language (rounded card, brand icon, change
  link) so the swap doesn't feel jarring.

  The Change link goes back to the picker root (no date param), which
  the Picker interprets as "show the calendar again".
*/

import { ArrowRight, Calendar } from "./icons.tsx";
import { pickerHref } from "../lib/picker-links.ts";

interface DateCardProps {
  date: string; // YYYY-MM-DD (host-local)
  dateLabel: string; // pre-formatted "Friday, 28 August 2026"
  /** Called when the Change link is clicked. When provided, Change is
   *  a <button> with onClick (no navigation, no SSR roundtrip). When
   *  omitted, Change is an <a href> for the no-JS / /embed fallback,
   *  built from `basePath`. */
  onClear?: () => void;
  /** "" for the standalone page (Change → "/"), "/embed" for the
   *  iframe variant (Change → "/embed"). Defaults to "". */
  basePath?: string;
  /** The visitor's IANA zone, once known (mig#15) — threaded onto the
   *  Change link so /embed's tz query param survives. */
  tz?: string | null;
}

export function DateCard(
  { dateLabel, onClear, basePath = "", tz }: DateCardProps,
) {
  // Focus styles live on the outer <button>/<a> (the actual focusable
  // element). Earlier refactor wrapped the inner <span> in an outer
  // button — the outer one had `focus:outline-none`, the inner span
  // had `focus-visible:underline` but never received focus, so the
  // visible focus indicator disappeared.
  const changeClass =
    "shrink-0 inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-brand-600 dark:hover:text-brand-300 transition-colors focus:outline-none focus-visible:underline";

  return (
    <div class="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3">
      <div class="flex items-center gap-3 min-w-0">
        <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <Calendar />
        </span>
        <div class="min-w-0">
          <p class="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
            Date
          </p>
          <p class="text-sm font-medium text-ink truncate tnum">
            {dateLabel}
          </p>
        </div>
      </div>
      {onClear
        ? (
          <button
            type="button"
            onClick={onClear}
            aria-label="Change date"
            class={changeClass}
          >
            Change
            <ArrowRight size={12} />
          </button>
        )
        : (
          <a
            href={pickerHref(basePath, undefined, tz)}
            aria-label="Change date"
            class={changeClass}
          >
            Change
            <ArrowRight size={12} />
          </a>
        )}
    </div>
  );
}
