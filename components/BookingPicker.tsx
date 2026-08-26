// Booking picker — server-rendered. Three states, all URL-driven so
// the full booking flow works without JS:
//
//   /                      → "1. Pick a date" (vertical month grid)
//   /?date=2026-09-15      → date card + "2. Pick a time"
//   /?date=…&slot=14:00    → date card + time card + "3. Your details"

interface DateCell {
  date: string;
  dayShort: string;
  dayNum: number;
  monthShort: string;
  monthName: string;
  year: number;
  monthIdx: number;
  slots: number;
  full: boolean;
}

interface SlotCell {
  time: string;
  available: boolean;
}

interface BookingPickerProps {
  dates: DateCell[];
  slots: SlotCell[];
  selectedDate: string | null;
  selectedDateLabel: string | null;
  selectedSlot: string | null;
  durationMin: number;
}

export function BookingPicker(props: BookingPickerProps) {
  const {
    dates,
    slots,
    selectedDate,
    selectedDateLabel,
    selectedSlot,
    durationMin,
  } = props;

  // Group dates by year + month so the layout reads top-to-bottom,
  // month by month. With a 14-day horizon this is at most 2 months.
  const months: Array<
    { year: number; monthIdx: number; monthName: string; cells: DateCell[] }
  > = [];
  for (const d of dates) {
    let bucket = months.find(
      (m) => m.year === d.year && m.monthIdx === d.monthIdx,
    );
    if (!bucket) {
      bucket = {
        year: d.year,
        monthIdx: d.monthIdx,
        monthName: d.monthName,
        cells: [],
      };
      months.push(bucket);
    }
    bucket.cells.push(d);
  }

  const hasDate = !!selectedDate;
  const hasSlot = !!selectedSlot;

  return (
    <div class="space-y-8">
      {/* Step 1 — date card OR date picker */}
      <section>
        <h2 class="text-lg font-semibold text-slate-100 mb-3 flex items-center gap-2">
          <span class="text-orange-500">1.</span>
          {hasDate ? "Date" : "Pick a date"}
        </h2>
        {hasDate
          ? (
            <DateCard
              label={selectedDateLabel ?? selectedDate}
              changeHref="/"
            />
          )
          : <MonthGrid months={months} />}
      </section>

      {/* Step 2 — slot card (after slot picked) OR slot grid (after date picked) */}
      {hasDate && (
        <section>
          <h2 class="text-lg font-semibold text-slate-100 mb-3 flex items-center gap-2">
            <span class="text-orange-500">2.</span>
            {hasSlot ? "Time" : "Pick a time"}
          </h2>
          {hasSlot
            ? (
              <SlotCard
                time={selectedSlot!}
                changeHref={`/?date=${selectedDate}`}
              />
            )
            : slots.length > 0
            ? (
              <SlotGrid
                slots={slots}
                date={selectedDate!}
              />
            )
            : (
              <p class="text-slate-500 text-sm">
                No available times for this date.
              </p>
            )}
        </section>
      )}

      {/* Step 3 — form (after date+slot picked) */}
      {hasDate && hasSlot && (
        <section>
          <h2 class="text-lg font-semibold text-slate-100 mb-3 flex items-center gap-2">
            <span class="text-orange-500">3.</span>
            Your details
          </h2>
          <BookingForm date={selectedDate!} slot={selectedSlot!} />
        </section>
      )}

      {
        /* Hidden copy of the duration — the post-pick cards reference this
          in their "X minutes" hint. Not rendered when no pick yet. */
      }
      {hasDate && hasSlot && (
        <p class="text-slate-500 text-xs -mt-6">
          {durationMin}-minute call.
        </p>
      )}
    </div>
  );
}

// ─── Date picker — vertical, grouped by month, no horizontal scroll ──

function MonthGrid({
  months,
}: {
  months: Array<
    { year: number; monthIdx: number; monthName: string; cells: DateCell[] }
  >;
}) {
  if (months.length === 0) {
    return (
      <p class="text-slate-500 text-sm">
        No available dates in the booking window.
      </p>
    );
  }
  return (
    <div class="space-y-6">
      {months.map((m) => (
        <div key={`${m.year}-${m.monthIdx}`}>
          <h3 class="text-sm font-medium text-slate-400 uppercase tracking-wider mb-2">
            {m.monthName} {m.year}
          </h3>
          <div class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 gap-2">
            {m.cells.map((d) => <DayCell key={d.date} d={d} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function DayCell({ d }: { d: DateCell }) {
  const baseClass =
    "flex flex-col items-center justify-center rounded-lg border px-2 py-3 transition-colors select-none text-center min-h-[68px]";
  if (d.full) {
    return (
      <div
        class={`${baseClass} border-slate-800 text-slate-600 cursor-not-allowed`}
        title="No slots available"
      >
        <div class="text-[10px] uppercase tracking-wider text-slate-600">
          {d.dayShort}
        </div>
        <div class="text-xl font-semibold tabular-nums leading-tight">
          {d.dayNum}
        </div>
      </div>
    );
  }
  return (
    <a
      href={`/?date=${d.date}`}
      class={`${baseClass} border-slate-700 hover:border-slate-600 hover:bg-slate-800/60 text-slate-200`}
    >
      <div class="text-[10px] uppercase tracking-wider text-slate-500">
        {d.dayShort}
      </div>
      <div class="text-xl font-semibold tabular-nums leading-tight">
        {d.dayNum}
      </div>
      <div class="text-[10px] text-slate-500 mt-0.5">
        {d.slots} slot{d.slots === 1 ? "" : "s"}
      </div>
    </a>
  );
}

// ─── Picked date / time card with a "Change" link ───

function DateCard({
  label,
  changeHref,
}: {
  label: string;
  changeHref: string;
}) {
  return (
    <div class="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-orange-500/40 bg-orange-500/5">
      <div class="flex items-center gap-3 min-w-0">
        <div class="shrink-0 w-8 h-8 rounded-md bg-orange-500/15 flex items-center justify-center">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f97316"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
        <span class="text-slate-100 font-medium truncate">{label}</span>
      </div>
      <a
        href={changeHref}
        class="shrink-0 text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        Change
      </a>
    </div>
  );
}

function SlotCard({
  time,
  changeHref,
}: {
  time: string;
  changeHref: string;
}) {
  return (
    <div class="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-orange-500/40 bg-orange-500/5">
      <div class="flex items-center gap-3 min-w-0">
        <div class="shrink-0 w-8 h-8 rounded-md bg-orange-500/15 flex items-center justify-center">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f97316"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <span class="text-slate-100 font-medium tabular-nums">{time}</span>
      </div>
      <a
        href={changeHref}
        class="shrink-0 text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        Change
      </a>
    </div>
  );
}

// ─── Slot grid (shown after date picked, before slot picked) ───

function SlotGrid({
  slots,
  date,
}: {
  slots: SlotCell[];
  date: string;
}) {
  return (
    <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
      {slots.map((s) => {
        const isSelected = s.time === null; // unreachable, kept for shape
        const baseClass =
          "px-3 py-2.5 rounded-lg border text-sm font-medium tabular-nums transition-colors select-none text-center";
        if (!s.available) {
          return (
            <div
              key={s.time}
              class={`${baseClass} border-slate-800 bg-slate-800/30 text-slate-600 line-through cursor-not-allowed`}
              title="Already booked or in the past"
            >
              {s.time}
            </div>
          );
        }
        return (
          <a
            key={s.time}
            href={`/?date=${date}&slot=${encodeURIComponent(s.time)}`}
            class={`${baseClass} ${
              isSelected
                ? "bg-orange-500 border-orange-500 text-white"
                : "border-slate-700 hover:border-slate-600 hover:bg-slate-800/60 text-slate-200"
            }`}
          >
            {s.time}
          </a>
        );
      })}
    </div>
  );
}

// ─── Booking form (shown after date+slot picked) ───

function BookingForm({ date, slot }: { date: string; slot: string }) {
  return (
    <form
      method="POST"
      action="/api/book"
      class="space-y-4 max-w-md"
    >
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="slot" value={slot} />

      <div>
        <label
          for="name"
          class="block text-sm font-medium text-slate-300 mb-1.5"
        >
          Your name
        </label>
        <input
          type="text"
          id="name"
          name="name"
          required
          minLength={2}
          maxLength={100}
          autocomplete="name"
          placeholder="Jane Doe"
          class="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
        />
      </div>

      <div>
        <label
          for="email"
          class="block text-sm font-medium text-slate-300 mb-1.5"
        >
          Email
        </label>
        <input
          type="email"
          id="email"
          name="email"
          required
          autocomplete="email"
          placeholder="jane@example.com"
          class="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
        />
      </div>

      <div>
        <label
          for="notes"
          class="block text-sm font-medium text-slate-300 mb-1.5"
        >
          Notes <span class="text-slate-500 font-normal">(optional)</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={500}
          placeholder="Anything I should know before we meet?"
          class="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors resize-y"
        />
      </div>

      {
        /*
        Honeypot — offscreen, tabindex -1, aria-hidden. Real users never
        fill this. Bots skip CSS-hidden fields; absolute-positioning offscreen
        is the trick.
      */
      }
      <div
        aria-hidden="true"
        style="position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden"
      >
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autocomplete="off"
          />
        </label>
      </div>

      <div class="pt-2">
        <button
          type="submit"
          class="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 active:bg-orange-600 text-white font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-slate-900"
        >
          Confirm — {slot}
        </button>
        <p class="text-xs text-slate-500 mt-2">
          We'll send a confirmation email with a calendar invite.
        </p>
      </div>
    </form>
  );
}
