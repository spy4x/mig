/*
  TimeCard — compact summary of the selected time slot.

  Shown in place of the full TimeSlots grid once a slot is picked.
  Same visual contract as DateCard so the swap reads as a deliberate
  progression, not a state change.
*/

interface TimeCardProps {
  date: string; // YYYY-MM-DD (host-local)
  slot: string; // HH:MM
  dateLabel: string; // "Friday, 28 August 2026"
}

function ClockIcon() {
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
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  );
}

export function TimeCard({ date, slot, dateLabel }: TimeCardProps) {
  return (
    <div class="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3">
      <div class="flex items-center gap-3 min-w-0">
        <span class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <ClockIcon />
        </span>
        <div class="min-w-0">
          <p class="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
            Time
          </p>
          <p class="text-sm font-medium text-ink truncate tnum">
            {slot}{" "}
            <span class="text-ink-subtle font-normal">· {dateLabel}</span>
          </p>
        </div>
      </div>
      <a
        href={`/?date=${date}`}
        class="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-brand-600 dark:hover:text-brand-300 transition-colors focus:outline-none focus-visible:underline"
        aria-label="Change time"
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
