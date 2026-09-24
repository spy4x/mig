/*
  Time slots grid. Groups slots by period (morning / afternoon /
  evening) so long availability windows don't become a wall of chips.

  Slot links go to /?date=...&slot=HH:MM so the URL stays the source
  of truth — no JS required to advance the booking flow.

  Display TZ: each slot's `time` is stored as host-local HH:MM (the
  authoritative value the server books against). The route/island can
  pass a `displayHHMM` per slot — just the clock time in the visitor's
  zone. SSR / no-JS leave it unset and the host-local HH:MM renders
  bare (the visitor's zone genuinely isn't known yet in that case — see
  the "Times are shown in the host's timezone" note the caller renders
  alongside).

  One zone label, not twenty (mig#48): every slot used to repeat its
  full "HH:MM, City, UTC±N" clock string (mig#15 — every time shown to
  a person carries its city and offset, not a bare HH:MM), so a day
  with twenty slots repeated the same city and offset twenty times and
  the one part that actually differs — the time — got lost in the
  noise. The zone (`zoneLabel` prop, e.g. "Berlin, UTC+2") now renders
  once, in the grid's header, and each slot shows only its HH:MM. mig#15's
  rule still holds for the *accessible* name: every slot's own full
  "HH:MM, City, UTC±N" (`ariaZoneLabel`), plus its `dateNote` when one
  is shown, goes on its `aria-label` (or, for the selected/booked
  chips, which render as a plain non-interactive `<span>`, a visually
  hidden `sr-only` element instead — `aria-label` isn't reliably read
  on an element with no interactive role) — so a screen reader that
  jumps straight to a chip still hears the complete time and day. And
  when a slot's own UTC offset differs from the header's — a
  daylight-saving change landing on one of the visible slots — the
  slot also shows its own offset inline (`offsetNote`, e.g.
  "03:00, UTC+1"), so no time in the grid is ever ambiguous.

  Grouping (mig#15 review): slots are grouped into contiguous runs of
  the same period, in the order the (already instant-sorted) array
  gives them — not into three fixed Morning/Afternoon/Evening sections
  always shown in that order. A host day whose slots cross midnight in
  the visitor's zone produces an Evening run (the previous calendar
  day, chronologically first) followed by a Morning run (the current
  day) — showing them in that true chronological order, rather than
  always Morning-then-Evening, is what stops a visitor from booking
  what looks like "later" but is actually earlier. Each slot whose
  visitor-local date differs from the picked day also carries its own
  `dateNote` ("Wed 23 Sep"), since even a correctly-ordered "Evening"
  heading doesn't say *which* evening.

  Periods (based on the time being displayed):
    morning   05:00–11:59
    afternoon 12:00–16:59
    evening   17:00–04:59 (wraps midnight)
*/

import { pickerHref } from "../lib/picker-links.ts";

interface SlotCell {
  time: string; // host-local HH:MM, authoritative
  available: boolean;
  /** "HH:MM" in the visitor's zone (mig#48). When present, the button
   *  renders this instead of `time`, and the period bucket is
   *  computed from it. Falls back to bare `time` (host TZ) when
   *  absent — the visitor's zone isn't known yet (SSR pass before
   *  hydration, or /embed before its tz redirect lands). */
  displayHHMM?: string;
  /** This slot's own full "HH:MM, City, UTC±N" (mig#15, mig#48) —
   *  used for the button's accessible name only, never the visible
   *  text, so a screen reader that jumps straight to one button still
   *  hears the complete time. Set together with `displayHHMM`. */
  ariaZoneLabel?: string;
  /** This slot's own UTC offset ("UTC+1"), set only when it differs
   *  from the grid header's `zoneLabel` — a daylight-saving change
   *  landing on one of the visible slots (mig#48). Rendered inline
   *  next to the time so that slot is never ambiguous. */
  offsetNote?: string;
  /** "Wed 23 Sep" — set only when this slot's visitor-local date
   *  differs from the picked day (mig#15 review). Rendered as a small
   *  second line on the chip. */
  dateNote?: string;
}

interface TimeSlotsProps {
  date: string; // YYYY-MM-DD (host-local)
  dateLabel: string; // pre-formatted "Thursday, 28 August 2026"
  slots: SlotCell[];
  selectedSlot?: string | null;
  /** Called when an available slot is picked. When provided, slots
   *  render as <button> with onClick. When omitted, slots render as
   *  <a href> for the no-JS / /embed fallback, built from
   *  `basePath`. */
  onSelectSlot?: (date: string, slot: string) => void;
  /** "" for the standalone page, "/embed" for the iframe variant.
   *  Defaults to "". */
  basePath?: string;
  /** The visitor's IANA zone, once known (mig#15) — threaded onto
   *  every slot's `<a href>` so /embed's tz query param survives. */
  tz?: string | null;
  /** "Berlin, UTC+2" (mig#48) — the display zone shown once, above the
   *  grid, next to `dateLabel`. Every slot's own offset is compared
   *  against this (see `SlotCell.offsetNote`). Omit/`null` while the
   *  display zone isn't known yet. */
  zoneLabel?: string | null;
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

interface SlotGroup {
  key: string;
  period: Period;
  slots: SlotCell[];
}

// Contiguous runs of the same period, in array order (mig#15 review —
// see the file header comment for why this replaces a fixed 3-bucket
// layout). The island/route passes `slots` already sorted by instant.
function groupByConsecutivePeriod(slots: SlotCell[]): SlotGroup[] {
  const groups: SlotGroup[] = [];
  for (const s of slots) {
    const period = periodFor(s.displayHHMM ?? s.time);
    const last = groups[groups.length - 1];
    if (last && last.period === period) {
      last.slots.push(s);
    } else {
      groups.push({ key: `${groups.length}-${period}`, period, slots: [s] });
    }
  }
  return groups;
}

export function TimeSlots(
  {
    date,
    dateLabel,
    slots,
    selectedSlot,
    onSelectSlot,
    basePath = "",
    tz,
    zoneLabel,
  }: TimeSlotsProps,
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

  const groups = groupByConsecutivePeriod(slots);

  return (
    <div class="rounded-2xl border border-line bg-surface-raised overflow-hidden">
      <div class="px-5 py-4 border-b border-line">
        <h3 class="text-sm font-medium text-ink-muted">{dateLabel}</h3>
        {zoneLabel && <p class="text-xs text-ink-subtle mt-0.5">{zoneLabel}</p>}
      </div>

      <div class="divide-y divide-line">
        {groups.map((g) => (
          <div key={g.key} class="px-5 py-4">
            <h4 class="text-[11px] font-medium uppercase tracking-wider text-ink-subtle mb-3">
              {PERIOD_LABEL[g.period]}
            </h4>
            <div class="flex flex-wrap gap-2">
              {g.slots.map((s) => (
                <SlotButton
                  key={s.time}
                  date={date}
                  slot={s}
                  selected={selectedSlot === s.time}
                  onSelect={onSelectSlot}
                  basePath={basePath}
                  tz={tz}
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
  { date, slot, selected, onSelect, basePath, tz }: {
    date: string;
    slot: SlotCell;
    selected: boolean;
    onSelect?: (date: string, slot: string) => void;
    basePath: string;
    tz?: string | null;
  },
) {
  const base =
    "inline-flex flex-col min-h-10 min-w-[4.5rem] items-center justify-center gap-0 rounded-lg border px-3 py-1.5 text-sm tnum font-medium transition-all duration-(--duration-snappy) focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised";
  // What the user actually sees. Falls back to host-local when the
  // island hasn't computed a visitor-TZ displayHHMM yet (SSR + /embed
  // + pre-hydration).
  const shownTime = slot.displayHHMM ?? slot.time;
  // Visible text (mig#48): bare HH:MM, plus this slot's own offset
  // only when it disagrees with the grid header's — a daylight-saving
  // change landing on this slot. The zone/city stays in the header;
  // repeating it here would be exactly the noise this issue removed.
  const visibleTime = slot.offsetNote
    ? `${shownTime}, ${slot.offsetNote}`
    : shownTime;
  // Full accessible name (mig#15, mig#48, mig#48 review): the slot's
  // own full "HH:MM, City, UTC±N", plus its date note ("Wed 23 Sep")
  // when one is shown — a screen reader that only reads the
  // accessible name must still hear which day this slot falls on, not
  // just the clock. Omitted in the fallback case (no visitor zone
  // known yet), matching the plain HH:MM the chip already shows.
  const fullLabel = slot.ariaZoneLabel
    ? `${shownTime}, ${slot.ariaZoneLabel}${
      slot.dateNote ? `, ${slot.dateNote}` : ""
    }`
    : undefined;
  const visible = (
    <>
      <span>{visibleTime}</span>
      {slot.dateNote && (
        <span class="text-[10px] font-normal leading-tight opacity-80">
          {slot.dateNote}
        </span>
      )}
    </>
  );
  // Selected/booked chips render as a plain <span> — no interactive
  // role, so `aria-label` isn't reliably exposed by every screen
  // reader (mig#48 review). Visually hidden text inside the element
  // is: `sr-only` carries `fullLabel`, and the visible chip is
  // `aria-hidden` so the two aren't read twice. `display: contents` on
  // the hidden wrapper keeps the visible spans as direct flex children
  // of `base`, so `flex-col`/`gap` still apply as if it weren't there.
  const spanContent = fullLabel
    ? (
      <>
        <span class="sr-only">{fullLabel}</span>
        <span aria-hidden="true" class="contents">{visible}</span>
      </>
    )
    : visible;

  if (selected) {
    return (
      <span
        aria-current="true"
        title="Selected"
        class={`${base} border-brand-500 bg-brand-500 text-white font-semibold shadow-sm cursor-default`}
      >
        {spanContent}
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
        {spanContent}
      </span>
    );
  }

  if (onSelect) {
    return (
      <button
        type="button"
        aria-label={fullLabel}
        onClick={() => onSelect(date, slot.time)}
        class={`${base} border-line bg-surface-raised text-ink hover:border-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30 hover:text-brand-700 dark:hover:text-brand-200 active:scale-[0.98]`}
      >
        {visible}
      </button>
    );
  }

  return (
    <a
      href={pickerHref(basePath, { date, slot: slot.time }, tz)}
      aria-label={fullLabel}
      class={`${base} border-line bg-surface-raised text-ink hover:border-brand-300 hover:bg-brand-50 dark:hover:bg-brand-900/30 hover:text-brand-700 dark:hover:text-brand-200 active:scale-[0.98]`}
    >
      {visible}
    </a>
  );
}
