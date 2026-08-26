/*
  Picker — orchestrates the 3-step booking flow.

  URL-driven so it works without JS:
    /                      → step 1: pick a date
    /?date=YYYY-MM-DD      → step 2: pick a time
    /?date=…&slot=HH:MM    → step 3: enter details
    /?month=YYYY-MM-DD     → calendar showing that month (step 1 only)

  Once a date or slot is picked, the full picker (calendar / slot
  grid) collapses into a compact summary card with a Change link.
  This keeps the page focused — the user doesn't see a wall of dates
  after they've already picked one.

  All three steps render on the same page (no multi-page navigation);
  the URL is the state. The browser back button does the right thing.
*/

import { Calendar } from "./Calendar.tsx";
import { TimeSlots } from "./TimeSlots.tsx";
import { DateCard } from "./DateCard.tsx";
import { TimeCard } from "./TimeCard.tsx";
import { BookingForm } from "./BookingForm.tsx";

interface DateCell {
  date: string;
  slots: number;
}

interface SlotCell {
  time: string;
  available: boolean;
}

interface PickerProps {
  dates: DateCell[];
  slots: SlotCell[];
  selectedDate: string | null;
  selectedDateLabel: string | null;
  selectedSlot: string | null;
  monthAnchor: string;
  durationMin: number;
  hostName: string;
  hostTz: string;
  error: string | null;
  /** "Fri, 28 Aug, 14:00" — host-local. Computed by the route so the
   *  button label matches what's already on screen. */
  confirmLabel: string | null;
}

export function Picker(props: PickerProps) {
  const {
    dates,
    slots,
    selectedDate,
    selectedDateLabel,
    selectedSlot,
    monthAnchor,
    durationMin,
    hostName,
    hostTz,
    error,
    confirmLabel,
  } = props;

  const slotsByDate: Record<string, number> = {};
  let minDate = "";
  let maxDate = "";
  for (const d of dates) {
    slotsByDate[d.date] = d.slots;
    if (!minDate || d.date < minDate) minDate = d.date;
    if (!maxDate || d.date > maxDate) maxDate = d.date;
  }

  const hasDate = !!selectedDate;
  const hasSlot = !!selectedSlot;

  return (
    <div class="space-y-5 sm:space-y-7">
      {/* Step 1 — date */}
      <section aria-labelledby="step-date">
        <StepHeader
          step={1}
          label={hasDate ? "Date" : "Choose a date"}
          active
        />
        <div class="mt-3">
          {hasDate
            ? (
              <DateCard
                date={selectedDate!}
                dateLabel={selectedDateLabel ?? selectedDate!}
              />
            )
            : (
              <Calendar
                monthAnchor={monthAnchor}
                minDate={minDate || new Date().toISOString().slice(0, 10)}
                maxDate={maxDate || new Date().toISOString().slice(0, 10)}
                slotsByDate={slotsByDate}
                selectedDate={selectedDate}
                hostTz={hostTz}
              />
            )}
        </div>
      </section>

      {/* Step 2 — time (only after date picked) */}
      {hasDate && (
        <section
          aria-labelledby="step-time"
          class="scroll-mt-20 step-in"
        >
          <StepHeader
            step={2}
            label={hasSlot ? "Time" : "Choose a time"}
            active
          />
          <div class="mt-3">
            {hasSlot
              ? (
                <TimeCard
                  date={selectedDate!}
                  slot={selectedSlot!}
                  dateLabel={selectedDateLabel ?? selectedDate!}
                />
              )
              : slots.length > 0
              ? (
                <TimeSlots
                  date={selectedDate!}
                  dateLabel={selectedDateLabel ?? selectedDate!}
                  slots={slots}
                  selectedSlot={selectedSlot}
                />
              )
              : (
                <div class="rounded-2xl border border-line bg-surface-raised px-5 py-10 text-center">
                  <p class="text-sm text-ink-muted">
                    No available times on {selectedDateLabel ?? selectedDate}.
                  </p>
                </div>
              )}
          </div>
        </section>
      )}

      {/* Step 3 — booking form (only after date+slot picked) */}
      {hasDate && hasSlot && (
        <section
          aria-labelledby="step-details"
          class="scroll-mt-20 step-in"
        >
          <StepHeader step={3} label="Your details" active />
          <div class="mt-3">
            <BookingForm
              date={selectedDate!}
              slot={selectedSlot!}
              dateLabel={selectedDateLabel ?? selectedDate!}
              durationMin={durationMin}
              hostName={hostName}
              error={error}
              confirmLabel={confirmLabel ?? `Confirm — ${selectedSlot}`}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function StepHeader(
  { step, label, active }: {
    step: number;
    label: string;
    active?: boolean;
  },
) {
  return (
    <div class="flex items-center gap-2.5">
      <span
        class={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold tnum ${
          active
            ? "bg-brand-500 text-white"
            : "bg-surface-sunken text-ink-subtle"
        }`}
      >
        {step}
      </span>
      <h2
        id={`step-${step === 1 ? "date" : step === 2 ? "time" : "details"}`}
        class={`text-sm font-semibold tracking-(--tracking-tight) ${
          active ? "text-ink" : "text-ink-subtle"
        }`}
      >
        {label}
      </h2>
    </div>
  );
}
