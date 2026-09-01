/*
  Time slots grid. Groups slots by period (morning / afternoon /
  evening) so long availability windows don't become a wall of chips.

  Slot links go to /?date=...&slot=HH:MM so the URL stays the source
  of truth — no JS required to advance the booking flow.

  Periods (host-local):
    morning   05:00–11:59
    afternoon 12:00–16:59
    evening   17:00–04:59 (wraps midnight)
*/

interface SlotCell {
  time: string;
  available: boolean;
}

interface TimeSlotsProps {
  date: string; // YYYY-MM-DD (host-local)
  dateLabel: string; // pre-formatted "Thursday, 28 August 2026"
  slots: SlotCell[];
  selectedSlot?: string | null;
  /** Called when an available slot is picked. When provided, slots
   *  render as <button> with onClick. When omitted, slots render as
   *  <a href="/?date=…&slot=…"> for the no-JS / /embed fallback. */
  onSelectSlot?: (date: string, slot: string) => void;
}

type Period = "morning" | "afternoon" | "evening";

function periodFor(time: string): Period {
  const h = parseInt(time.slice(0, 2), 10);
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

const PERIOD_LABEL: Record<Period, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

const PERIOD_ORDER: Period[] = ["morning", "afternoon", "evening"];

export function TimeSlots(
  { date, dateLabel, slots, selectedSlot, onSelectSlot }: TimeSlotsProps,
) {
  if (slots.length === 0) {
    return (
      <div class="rounded-2xl border border-line bg-surface-raised px-5 py-10 text-center">
        <p class="text-sm text-ink-muted">
          No available times on {dateLabel}.
        </p>
      </div>
    );
  }

  // Bucket slots by period, preserving the input order within each.
  const buckets: Record<Period, SlotCell[]> = {
    morning: [],
    afternoon: [],
    evening: [],
  };
  for (const s of slots) buckets[periodFor(s.time)].push(s);

  const periods = PERIOD_ORDER.filter((p) => buckets[p].length > 0);

  return (
    <div class="rounded-2xl border border-line bg-surface-raised overflow-hidden">
      <div class="px-5 py-4 border-b border-line">
        <h3 class="text-sm font-medium text-ink-muted">{dateLabel}</h3>
      </div>

      <div class="divide-y divide-line">
        {periods.map((p) => (
          <div key={p} class="px-5 py-4">
            <h4 class="text-[11px] font-medium uppercase tracking-wider text-ink-subtle mb-3">
              {PERIOD_LABEL[p]}
            </h4>
            <div class="flex flex-wrap gap-2">
              {buckets[p].map((s) => (
                <SlotButton
                  key={s.time}
                  date={date}
                  slot={s}
                  selected={selectedSlot === s.time}
                  onSelect={onSelectSlot}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SlotButton(
  { date, slot, selected, onSelect }: {
    date: string;
    slot: SlotCell;
    selected: boolean;
    onSelect?: (date: string, slot: string) => void;
  },
) {
  const base =
    "inline-flex h-10 min-w-[4.5rem] items-center justify-center rounded-lg border px-3 text-sm tnum font-medium transition-all duration-(--duration-snappy) focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised";

  if (selected) {
    return (
      <span
        aria-current="true"
        title="Selected"
        class={`${base} border-brand-500 bg-brand-500 text-white font-semibold shadow-sm cursor-default`}
      >
        {slot.time}
      </span>
    );
  }

  if (!slot.available) {
    return (
      <span
        aria-disabled="true"
        title="Already booked"
        class={`${base} border-line bg-surface-sunken text-ink-subtle/60 line-through decoration-ink-subtle/40 cursor-not-allowed`}
      >
        {slot.time}
      </span>
    );
  }

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(date, slot.time)}
        class={`${base} border-line bg-surface-raised text-ink hover:border-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30 hover:text-brand-700 dark:hover:text-brand-200 active:scale-[0.98]`}
      >
        {slot.time}
      </button>
    );
  }

  return (
    <a
      href={`/?date=${date}&slot=${encodeURIComponent(slot.time)}`}
      class={`${base} border-line bg-surface-raised text-ink hover:border-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30 hover:text-brand-700 dark:hover:text-brand-200 active:scale-[0.98]`}
    >
      {slot.time}
    </a>
  );
}
