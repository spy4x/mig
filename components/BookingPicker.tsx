// Booking picker — server-rendered. Date cells and slot cells are plain
// <a> links; only the booking form (last step) is a real <form> POSTing
// to /api/book. Zero JS required for full booking flow.

interface DateCell {
  date: string;
  label: string;
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
  selectedSlot: string | null;
  durationMin: number;
  hostTz: string;
  publicUrl: string;
}

export function BookingPicker(props: BookingPickerProps) {
  const { dates, slots, selectedDate, selectedSlot, durationMin } = props;
  return (
    <div class="space-y-8">
      {/* Step 1 — Pick a date */}
      <section>
        <h2 class="text-lg font-semibold text-slate-100 mb-3">
          <span class="text-orange-500 mr-2">1.</span>Pick a date
        </h2>
        <DateStrip dates={dates} selected={selectedDate} />
        {dates.length === 0 && (
          <p class="text-slate-500 text-sm mt-3">
            No available dates in the booking window.
          </p>
        )}
      </section>

      {/* Step 2 — Pick a time */}
      {selectedDate && (
        <section>
          <h2 class="text-lg font-semibold text-slate-100 mb-1">
            <span class="text-orange-500 mr-2">2.</span>Pick a time
          </h2>
          <p class="text-slate-500 text-sm mb-3">
            Times shown in your browser's timezone.
          </p>
          {slots.length > 0
            ? (
              <SlotGrid
                slots={slots}
                date={selectedDate}
                selected={selectedSlot}
              />
            )
            : (
              <p class="text-slate-500 text-sm">
                No available times for this date.
              </p>
            )}
        </section>
      )}

      {/* Step 3 — Your details */}
      {selectedDate && selectedSlot && (
        <section>
          <h2 class="text-lg font-semibold text-slate-100 mb-3">
            <span class="text-orange-500 mr-2">3.</span>Your details
          </h2>
          <BookingForm
            date={selectedDate}
            slot={selectedSlot}
            durationMin={durationMin}
          />
        </section>
      )}
    </div>
  );
}

function DateStrip(
  { dates, selected }: { dates: DateCell[]; selected: string | null },
) {
  return (
    <div class="overflow-x-auto -mx-1 pb-2">
      <div class="flex gap-2 px-1 min-w-min">
        {dates.map((d) => {
          const isSelected = d.date === selected;
          const [dayName, dayNum, monthShort] = d.label.split(" ");
          const inner = (
            <>
              <div class="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
                {dayName}
              </div>
              <div class="text-xl font-semibold tabular-nums leading-tight">
                {dayNum}
              </div>
              <div class="text-[10px] text-slate-500">{monthShort}</div>
              <div
                class={`text-[10px] mt-1 ${
                  isSelected ? "text-white/80" : "text-slate-500"
                }`}
              >
                {d.slots > 0
                  ? `${d.slots} slot${d.slots === 1 ? "" : "s"}`
                  : "—"}
              </div>
            </>
          );
          const baseClass =
            "shrink-0 w-20 h-24 rounded-xl border flex flex-col items-center justify-center transition-all duration-150 select-none";
          if (d.full) {
            return (
              <div
                key={d.date}
                class={`${baseClass} border-slate-800 text-slate-600 cursor-not-allowed`}
              >
                {inner}
              </div>
            );
          }
          return (
            <a
              key={d.date}
              href={isSelected ? "/" : `/?date=${d.date}`}
              aria-current={isSelected ? "page" : undefined}
              class={`${baseClass} ${
                isSelected
                  ? "bg-orange-500 border-orange-500 text-white"
                  : "border-slate-700 hover:border-slate-600 hover:bg-slate-800/60 text-slate-200"
              }`}
            >
              {inner}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function SlotGrid(
  { slots, date, selected }: {
    slots: SlotCell[];
    date: string;
    selected: string | null;
  },
) {
  return (
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {slots.map((s) => {
        const isSelected = s.time === selected;
        const baseClass =
          "px-3 py-2.5 rounded-lg border text-sm font-medium tabular-nums transition-all duration-150 select-none text-center";
        if (!s.available) {
          return (
            <div
              key={s.time}
              class={`${baseClass} border-slate-800 bg-slate-800/30 text-slate-600 line-through cursor-not-allowed`}
            >
              {s.time}
            </div>
          );
        }
        return (
          <a
            key={s.time}
            href={isSelected
              ? `/?date=${date}`
              : `/?date=${date}&slot=${encodeURIComponent(s.time)}`}
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

function BookingForm(
  { date, slot }: {
    date: string;
    slot: string;
    durationMin: number;
  },
) {
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
          class="w-full px-3 py-2.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
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
        /* Honeypot — offscreen, tabindex -1, aria-hidden. Real users never
          fill this. Bots skip CSS-hidden fields; absolute-positioning offscreen
          is the trick. */
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
