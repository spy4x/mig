/*
  Summary bar — sticky reminder of the picked date at the bottom of
  the mobile viewport while the user scrolls through the slot grid.

  Behaviour:
    - Sticky to the bottom on mobile only (md:hidden). On desktop the
      page already provides the same affordance via the in-page card.
    - Renders only between date pick and slot pick. On step 3 (form)
      the in-page submit button takes over.
    - Pill-only — no CTA. The slot grid sits directly below the
      DateCard, so a "Pick a time" link that just scrolls/navigates
      to the same page is dead weight. If the user wants to back out
      they use the DateCard's Change button.
*/

interface SummaryBarProps {
  /** "none"  → bar is hidden.
   *  "date"  → date picked, no slot yet. Pill shows the date.
   *  "slot"  → date + slot picked, form is on screen. Bar stays out
   *            of the way — the in-page submit button is the CTA. */
  state: "none" | "date" | "slot";
  date: string | null;
  dateLabel: string | null;
  slot: string | null;
}

export function SummaryBar(props: SummaryBarProps) {
  const { state, date, dateLabel, slot } = props;
  // Hide entirely on step 3 — the in-page form already provides the
  // primary CTA and a floating bar here would just eat screen.
  if (state !== "date") return null;

  return (
    <div class="fixed inset-x-0 bottom-0 z-30 md:hidden pointer-events-none">
      <div class="mx-auto max-w-2xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div class="pointer-events-auto flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface-raised/95 backdrop-blur-md shadow-[0_8px_32px_-12px_rgb(0_0_0_/_0.18)] px-4 py-2.5">
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
      </div>
    </div>
  );
}
