/*
  Summary bar — shows the user what they've picked so far + the next
  action.

  Three states:
    - none picked          → hidden
    - date picked          → "Thu, 28 Aug"  → "Pick a time"
    - date + slot picked   → "Thu, 28 Aug · 14:00"  → "Enter details"

  Behaviour:
    - Sticky to the bottom on mobile (so the CTA is always at thumb
      height while scrolling through the time grid).
    - On desktop it's not sticky — the form below already provides
      the same affordance.
    - The "next" link is a real <a> so it works without JS and the
      back/forward buttons can revisit it.

  Hidden entirely once the user is on step 3 (form): the submit
  button takes over as the CTA.
*/

interface SummaryBarProps {
  /** "none"  → bar is hidden.
   *  "date"  → date picked, no slot yet. CTA: "Pick a time".
   *  "slot"  → date + slot picked, form is on screen. The bar stays
   *            out of the way — the in-page submit button is the CTA. */
  state: "none" | "date" | "slot";
  date: string | null;
  dateLabel: string | null;
  slot: string | null;
}

function nextHref(date: string | null): string {
  if (date) return `/?date=${date}`;
  return "/";
}

function nextLabel(): string {
  return "Pick a time";
}

export function SummaryBar(props: SummaryBarProps) {
  const { state, date, dateLabel, slot } = props;
  // Hide entirely on step 3 — the in-page form already provides the
  // primary CTA and a floating bar here would just eat screen.
  if (state !== "date") return null;

  const pill = (
    <div class="flex items-center gap-2 min-w-0">
      <span class="inline-flex h-7 w-7 items-center justify-center rounded-md bg-brand-500/10 text-brand-600 dark:text-brand-300 shrink-0">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </span>
      <span class="truncate text-sm font-medium text-ink tnum">
        {dateLabel ?? date}
        {slot && (
          <>
            <span class="text-ink-subtle mx-1.5">·</span>
            <span class="text-brand-600 dark:text-brand-300">{slot}</span>
          </>
        )}
      </span>
    </div>
  );

  const cta = (
    <a
      href={nextHref(date)}
      class="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 active:bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
    >
      {nextLabel()}
      <svg
        width="14"
        height="14"
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
  );

  return (
    <div class="fixed inset-x-0 bottom-0 z-30 md:hidden pointer-events-none">
      <div class="mx-auto max-w-2xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div class="pointer-events-auto flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface-raised/95 backdrop-blur-md shadow-[0_8px_32px_-12px_rgb(0_0_0_/_0.18)] px-4 py-3">
          {pill}
          {cta}
        </div>
      </div>
    </div>
  );
}
