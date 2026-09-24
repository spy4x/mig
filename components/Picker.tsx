/*
  Picker — orchestrates the 3-step booking flow.

  URL-driven so it works without JS. Relative to `basePath` ("" for
  the standalone page, "/embed" for the iframe variant — see
  lib/picker-links.ts):
    {base}                      → step 1: pick a date
    {base}?date=YYYY-MM-DD      → step 2: pick a time
    {base}?date=…&slot=HH:MM    → step 3: enter details
    {base}?month=YYYY-MM-DD     → calendar showing that month (step 1 only)

  Every link and form action this component renders stays under
  `basePath` — that's what keeps /embed self-contained (issue #11).

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
  displayHHMM?: string;
  ariaZoneLabel?: string;
  offsetNote?: string;
  dateNote?: string;
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
  /** "Fri, 28 Aug, 14:00, New York, UTC-4" — in the visitor's zone
   *  when known, host's otherwise. Computed by the route so the
   *  button label matches what's already on screen. */
  confirmLabel: string | null;
  /** "" for the standalone page, "/embed" for the iframe variant.
   *  Threaded down to every link/form so the flow never leaves the
   *  base path it started in (issue #11). Defaults to "". */
  basePath?: string;
  /** The visitor's IANA zone, once known (mig#15) — threaded onto
   *  every link this component renders (Calendar, DateCard, TimeCard,
   *  TimeSlots) so /embed's `tz` query param survives the whole flow,
   *  and into BookingForm's hidden `guestTz` field. Omit while the
   *  zone is still unknown (the host-timezone fallback). */
  tz?: string | null;
  /** "Fri, 28 Aug, 11:00, New York, UTC-4" — the selected slot's full
   *  clock string in the visitor's zone, for TimeCard. Falls back to
   *  the bare host-local `selectedSlot` when omitted. */
  displaySlot?: string | null;
  /** "Wednesday, 23 September 2026" — the selected slot's own date,
   *  built from its exact instant, not noon of the host day (mig#15
   *  review). Feeds TimeCard specifically; falls back to
   *  `selectedDateLabel` when omitted (no slot picked yet, or the
   *  caller hasn't computed one — e.g. the standalone baseline test). */
  slotDateLabel?: string | null;
  /** "Berlin, UTC+2" (mig#48) — the display zone, threaded straight
   *  into TimeSlots so it renders once, above the slot grid, instead
   *  of on every slot. Omit/`null` while the display zone isn't known
   *  yet (host-timezone fallback). */
  zoneLabel?: string | null;
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
    basePath = "",
    tz,
    displaySlot,
    slotDateLabel,
    zoneLabel,
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
      {
        /* Top-level banner — mirrors islands/BookingFlow.tsx's error
           banner exactly (same markup, same role="alert"). It has to
           live here, above every step, because a rate-limit or
           validation failure redirects back with ?err=... and at most
           ?date=... — never ?slot=... — so the frame can land on step
           1 or step 2, not just step 3 where BookingForm lives. Passing
           `error={null}` to BookingForm below (instead of `error`)
           keeps it from rendering a second copy at step 3. */
      }
      {error && (
        <div
          role="alert"
          class="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </div>
      )}

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
                basePath={basePath}
                tz={tz}
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
                basePath={basePath}
                tz={tz}
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
                  dateLabel={slotDateLabel ?? selectedDateLabel ??
                    selectedDate!}
                  displaySlot={displaySlot ?? undefined}
                  basePath={basePath}
                  tz={tz}
                />
              )
              : slots.length > 0
              ? (
                <TimeSlots
                  date={selectedDate!}
                  dateLabel={selectedDateLabel ?? selectedDate!}
                  slots={slots}
                  selectedSlot={selectedSlot}
                  basePath={basePath}
                  tz={tz}
                  zoneLabel={zoneLabel}
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
              error={null}
              confirmLabel={confirmLabel ?? `Confirm — ${selectedSlot}`}
              basePath={basePath}
              guestTz={tz}
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
