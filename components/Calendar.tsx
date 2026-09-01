/*
  Calendar — single-month grid for picking a date.

  Renders a 7-column grid of day cells with the day-of-week header
  above. Cells know three states:
    - past / outside horizon   → disabled (greyed, no link)
    - no availability / full   → disabled (greyed, "Full" hint)
    - bookable                 → link to `/?date=YYYY-MM-DD`

  The selected date is highlighted with the brand accent regardless of
  its bookable state (the URL might already carry a ?date= param the
  user is editing).

  Month navigation: prev/next arrows flanking the header. Both are
  hidden when their target month has no bookable days — there's no
  point in showing a button that goes nowhere.

  hostTz is used purely for date arithmetic (DST-safe month start,
  weekday for the first row). It is never displayed.
*/

import { addDays, isoDateInTz } from "../lib/tz.ts";

interface CalendarProps {
  /** YYYY-MM-DD (host-local) — month we anchor on. */
  monthAnchor: string;
  /** YYYY-MM-DD — the first date that can be booked (today + minNotice). */
  minDate: string;
  /** YYYY-MM-DD — the last date that can be booked. */
  maxDate: string;
  /** Map of YYYY-MM-DD → remaining slots (0 = full). Only present for
   *  dates with at least one available time slot, so missing = "no
   *  availability / fully booked". */
  slotsByDate: Record<string, number>;
  selectedDate: string | null;
  hostTz: string;
  /** Called when a bookable day is clicked. When provided, days are
   *  rendered as <button> with onClick — no navigation, no SSR
   *  roundtrip. When omitted, days are <a href="/?date=…"> for the
   *  no-JS / /embed fallback. */
  onSelectDate?: (date: string) => void;
  /** Called when the prev/next month arrow is clicked. Same
   *  interactive/SSR contract as `onSelectDate`. */
  onSelectMonth?: (monthAnchor: string) => void;
}

const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfMonth(iso: string): string {
  return iso.slice(0, 8) + "01";
}

function shiftMonth(yyyymmdd: string, n: number): string {
  // Advance/regress a YYYY-MM-DD string by `n` months, clamping the
  // day-of-month to the new month's last day. We do not use this for
  // day arithmetic — only for month navigation URLs, which always
  // land on day 01.
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(5, 7));
  const total = (y * 12 + (m - 1)) + n;
  const newY = Math.floor(total / 12);
  const newM = (total % 12) + 1;
  return `${newY}-${String(newM).padStart(2, "0")}-01`;
}

function monthLabel(iso: string, tz: string): string {
  const dt = new Date(iso + "T12:00:00Z");
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: tz,
  }).format(dt);
}

function monthFirstDow(iso: string, tz: string): number {
  const dt = new Date(iso + "T12:00:00Z");
  const w = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
  }).format(dt).toUpperCase();
  const idx = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].indexOf(w);
  return idx === -1 ? 0 : idx;
}

function isBefore(a: string, b: string): boolean {
  return a < b;
}

function isAfter(a: string, b: string): boolean {
  return a > b;
}

export function Calendar(props: CalendarProps) {
  const {
    monthAnchor,
    minDate,
    maxDate,
    slotsByDate,
    selectedDate,
    hostTz,
    onSelectDate,
    onSelectMonth,
  } = props;

  const firstOfMonth = startOfMonth(monthAnchor);
  const firstDow = monthFirstDow(firstOfMonth, hostTz); // 0=Mon..6=Sun

  // 6-week grid (42 cells) — height is stable across months. Last
  // week may bleed into next month, which is the common "peek"
  // pattern in calendar UIs.
  const cells: Array<{ date: string; inMonth: boolean }> = [];
  for (let i = firstDow; i > 0; i--) {
    const d = addDays(firstOfMonth, -i, hostTz);
    cells.push({ date: d, inMonth: false });
  }
  let dayCursor = firstOfMonth;
  while (cells.length < 42) {
    cells.push({
      date: dayCursor,
      inMonth: dayCursor.slice(0, 7) === firstOfMonth.slice(0, 7),
    });
    dayCursor = addDays(dayCursor, 1, hostTz);
  }

  // Month navigation — strictly +1/-1 month arithmetic, no "add 28
  // days" tricks (those don't always land on the same month).
  const prevMonth = shiftMonth(firstOfMonth, -1);
  const nextMonth = shiftMonth(firstOfMonth, +1);
  const prevMonthKey = prevMonth.slice(0, 7);
  const nextMonthKey = nextMonth.slice(0, 7);
  const minMonthKey = minDate.slice(0, 7);
  const maxMonthKey = maxDate.slice(0, 7);

  const prevHasContent = !isBefore(prevMonthKey, minMonthKey) ||
    Object.keys(slotsByDate).some((k) => k.slice(0, 7) === prevMonthKey);
  const nextHasContent = !isAfter(nextMonthKey, maxMonthKey) ||
    Object.keys(slotsByDate).some((k) => k.slice(0, 7) === nextMonthKey);

  const today = isoDateInTz(new Date(), hostTz);

  return (
    <div class="rounded-2xl border border-line bg-surface-raised">
      {/* Month header */}
      <div class="flex items-center justify-between px-4 pt-4 pb-3">
        <h3 class="text-sm font-semibold tracking-(--tracking-tight) text-ink">
          {monthLabel(firstOfMonth, hostTz)}
        </h3>
        <div class="flex items-center gap-1">
          {onSelectMonth
            ? (
              <button
                type="button"
                aria-label="Previous month"
                disabled={!prevHasContent}
                onClick={() => prevHasContent && onSelectMonth(prevMonth)}
                class={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  prevHasContent ? "" : "opacity-30 cursor-not-allowed"
                }`}
              >
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
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
            )
            : (
              <a
                href={`/?month=${prevMonth}`}
                aria-label="Previous month"
                class={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  prevHasContent ? "" : "opacity-30 pointer-events-none"
                }`}
              >
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
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </a>
            )}
          {onSelectMonth
            ? (
              <button
                type="button"
                aria-label="Next month"
                disabled={!nextHasContent}
                onClick={() => nextHasContent && onSelectMonth(nextMonth)}
                class={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  nextHasContent ? "" : "opacity-30 cursor-not-allowed"
                }`}
              >
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
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            )
            : (
              <a
                href={`/?month=${nextMonth}`}
                aria-label="Next month"
                class={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  nextHasContent ? "" : "opacity-30 pointer-events-none"
                }`}
              >
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
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </a>
            )}
        </div>
      </div>

      {/* Day-of-week header */}
      <div class="grid grid-cols-7 gap-px px-2">
        {DOW_SHORT.map((d) => (
          <div
            key={d}
            class="text-center text-[11px] font-medium uppercase tracking-wider text-ink-subtle py-1"
          >
            {d.slice(0, 2)}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div class="grid grid-cols-7 gap-px p-2 pt-0">
        {cells.map(({ date, inMonth }) => {
          const inHorizon = !isBefore(date, minDate) && !isAfter(date, maxDate);
          const isSelected = selectedDate === date;
          const isToday = date === today;
          const slots = slotsByDate[date];
          const isFull = inHorizon && slots === 0;
          const isPast = isBefore(date, minDate);
          const isFuture = isAfter(date, maxDate);
          const disabled = !inMonth || isPast || isFuture || isFull;

          const dayNum = date.slice(8, 10);

          const cellBase =
            "relative aspect-square flex items-center justify-center rounded-lg text-sm tnum transition-colors select-none";
          const cellState = !inMonth
            ? "text-ink-subtle/30 cursor-default"
            : disabled
            ? "text-ink-subtle/50 cursor-not-allowed line-through decoration-ink-subtle/30"
            : isSelected
            ? "bg-brand-500 text-white font-semibold shadow-sm hover:bg-brand-600"
            : isToday
            ? "text-brand-600 dark:text-brand-300 font-semibold bg-brand-50 dark:bg-brand-500/10 hover:bg-brand-100 dark:hover:bg-brand-500/20"
            : "text-ink hover:bg-surface-sunken";

          const ariaLabel = (() => {
            if (!inMonth) return undefined;
            if (isPast) return `${date} — past`;
            if (isFuture) return `${date} — outside booking window`;
            if (isFull) return `${date} — fully booked`;
            return `${date} — ${slots} slot${slots === 1 ? "" : "s"} available`;
          })();

          if (disabled) {
            return (
              <div
                key={date}
                aria-hidden={!inMonth}
                aria-label={ariaLabel}
                class={`${cellBase} ${cellState}`}
              >
                {dayNum}
              </div>
            );
          }

          const dot = (!isSelected && slots > 0 && slots <= 4) || isToday;

          if (onSelectDate) {
            return (
              <button
                key={date}
                type="button"
                onClick={() => onSelectDate(date)}
                aria-label={ariaLabel}
                aria-current={isSelected ? "date" : undefined}
                class={`${cellBase} ${cellState} focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised ${
                  isSelected ? "selected-pulse" : ""
                }`}
              >
                {dayNum}
                {dot && (
                  <span
                    class="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-brand-500"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          }

          return (
            <a
              key={date}
              href={`/?date=${date}`}
              aria-label={ariaLabel}
              aria-current={isSelected ? "date" : undefined}
              class={`${cellBase} ${cellState} focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised ${
                isSelected ? "selected-pulse" : ""
              }`}
            >
              {dayNum}
              {dot && (
                <span
                  class="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-brand-500"
                  aria-hidden="true"
                />
              )}
            </a>
          );
        })}
      </div>
    </div>
  );
}
