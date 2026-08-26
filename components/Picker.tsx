/*
  Picker — orchestrates the 3-step booking flow.

  URL-driven so it works without JS:
    /                      → step 1: pick a date
    /?date=YYYY-MM-DD       → step 2: pick a time
    /?date=...&slot=HH:MM   → step 3: enter details

  All three steps render on the same page (no multi-page navigation);
  the URL is the state. This means the browser back button does the
  right thing and the user can bookmark/share any step.
*/

import { Calendar } from "./Calendar.tsx";
import { TimeSlots } from "./TimeSlots.tsx";
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
      {/* Step 1 — calendar */}
      <section aria-labelledby="step-date">
        <StepHeader
          step={1}
          label={hasDate ? "Date" : "Choose a date"}
          active
        />
        <div class="mt-3">
          <Calendar
            monthAnchor={monthAnchor}
            minDate={minDate || new Date().toISOString().slice(0, 10)}
            maxDate={maxDate || new Date().toISOString().slice(0, 10)}
            slotsByDate={slotsByDate}
            selectedDate={selectedDate}
            hostTz={hostTz}
          />
          {hasDate && (
            <div class="mt-3 flex justify-end step-in">
              <ChangeLink href="/" label="Choose a different date" />
            </div>
          )}
        </div>
      </section>

      {/* Step 2 — time slots (only after date picked) */}
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
            <TimeSlots
              date={selectedDate!}
              dateLabel={selectedDateLabel ?? selectedDate!}
              slots={slots}
              selectedSlot={selectedSlot}
            />
            {hasSlot && (
              <div class="mt-3 flex justify-end step-in">
                <ChangeLink
                  href={`/?date=${selectedDate}`}
                  label="Choose a different time"
                />
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
              durationMin={durationMin}
              hostName={hostName}
              error={error}
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

function ChangeLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      class="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-brand-600 dark:hover:text-brand-300 transition-colors focus:outline-none focus-visible:underline"
    >
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
        <path d="m15 18-6-6 6-6" />
      </svg>
      {label}
    </a>
  );
}
