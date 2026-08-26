/*
  DateCard — compact summary of the selected date.

  Shown in place of the full Calendar once a date is picked. Mirrors
  the calendar's visual language (rounded card, brand icon, change
  link) so the swap doesn't feel jarring.

  The Change link goes back to `/` (no date param), which the
  Picker interprets as "show the calendar again".
*/

interface DateCardProps {
  date: string; // YYYY-MM-DD (host-local)
  dateLabel: string; // pre-formatted "Friday, 28 August 2026"
}

function CalendarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function DateCard({ dateLabel }: DateCardProps) {
  return (
    <div class="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3">
      <div class="flex items-center gap-3 min-w-0">
        <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <CalendarIcon />
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
      <a
        href="/"
        class="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-brand-600 dark:hover:text-brand-300 transition-colors focus:outline-none focus-visible:underline"
        aria-label="Change date"
      >
        Change
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12h14" />
          <path d="m12 5 7 7-7 7" />
        </svg>
      </a>
    </div>
  );
}
