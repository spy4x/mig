import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Calendar } from "../components/Calendar.tsx";
import { TimeSlots } from "../components/TimeSlots.tsx";
import { DateCard } from "../components/DateCard.tsx";
import { TimeCard } from "../components/TimeCard.tsx";
import { BookingForm } from "../components/BookingForm.tsx";
import { SummaryBar } from "../components/SummaryBar.tsx";
import { isoDateInTz, zonedDateTime } from "../lib/tz.ts";

/*
  BookingFlow — client-driven booking picker.

  Replaces the URL-driven SSR roundtrip from issue #8:
    - Picking a date or slot updates local signals and `pushState`s
      into the URL instead of reloading the page.
    - After a date is picked, slots are re-fetched via
      `GET /api/slots?date=…` so a slot taken by another visitor
      between page loads is reflected.
    - Date/time labels are re-formatted in the visitor's local TZ
      after hydration, so the confirm-button label matches what the
      user expects to see.

  No-JS / /embed fallback: when this island is not hydrated (or is
  not mounted at all, as on `/embed`), the same SSR markup with
  `<a href>` links still works — the components accept `onSelect`
  callbacks, and when those are absent they render `<a href>`.

  Server-side first paint: the route still passes the same initial
  props (`dates`, `slots`, `selectedDate`, etc.) it always did.
  Fresh 2 renders this island server-side with those initial values,
  so the first paint is identical to what the old Picker produced.
  Hydration then attaches the signal handlers — no SSR markup
  mismatch.

  Why signals (not useState): the Calendar/TimeSlots/DateCard/etc.
  components re-render whenever a signal they read changes, and
  `pushState` is a one-liner side effect. useState would force
  lifting state + prop-drilling; signals keep the components
  presentational and let the orchestrator (this file) own state.
*/

interface DateCell {
  date: string;
  slots: number;
}

interface SlotCell {
  time: string;
  available: boolean;
}

interface BookingFlowProps {
  dates: DateCell[];
  slots: SlotCell[];
  selectedDate: string | null;
  selectedSlot: string | null;
  monthAnchor: string;
  durationMin: number;
  hostName: string;
  hostTz: string;
  error: string | null;
}

// ─── Client-side time helpers ────────────────────────────────────────
// Use lib/tz.ts directly — it's dependency-free (no zod) and already
// bundled into the client via Calendar's imports.

function formatDateLongInTz(
  date: string,
  time: string,
  hostTz: string,
  displayTz: string,
): string {
  const dt = zonedDateTime(date, time, hostTz);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: displayTz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dt);
}

// Compact "Thu, 28 Aug" used in the mobile SummaryBar. Mirrors
// TimeCard's display so the two stay in lockstep.
function formatDateShortInTz(
  date: string,
  time: string,
  hostTz: string,
  displayTz: string,
): string {
  const dt = zonedDateTime(date, time, hostTz);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: displayTz,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return fmt.format(dt).replace(/^([^,]+),/, "$1");
}

// HH:MM in the visitor's TZ, formatted from a host-local (date, time).
// Returns null if the formatting fails (rare; the Intl call is
// permissive).
function formatTimeInTz(
  date: string,
  time: string,
  hostTz: string,
  displayTz: string,
): string | null {
  try {
    const dt = zonedDateTime(date, time, hostTz);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: displayTz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(dt);
  } catch {
    return null;
  }
}

// Same as formatConfirmLabelInTz but takes the already-computed
// visitor-TZ time string so the button shows visitor time, not
// host time. Used when displayTz !== hostTz (the common case after
// hydration).
function formatConfirmLabelWithTime(
  date: string,
  time: string,
  hostTz: string,
  displayTz: string,
  visitorTime: string,
): string {
  const dt = zonedDateTime(date, time, hostTz);
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: displayTz,
    weekday: "short",
  }).format(dt);
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: displayTz,
    day: "numeric",
  }).format(dt);
  const month = new Intl.DateTimeFormat("en-GB", {
    timeZone: displayTz,
    month: "short",
  }).format(dt);
  return `Confirm — ${weekday}, ${day} ${month}, ${visitorTime}`;
}

// ─── URL helpers ─────────────────────────────────────────────────────

export default function BookingFlow(props: BookingFlowProps) {
  const hostTz = props.hostTz;

  // Signal-based state. Each signal is read inline below — Preact
  // re-renders the component when any signal changes.
  const date = useSignal<string | null>(props.selectedDate);
  const slot = useSignal<string | null>(props.selectedSlot);
  const month = useSignal<string>(props.monthAnchor);
  const slots = useSignal<SlotCell[]>(props.slots);
  const loading = useSignal(false);
  const fetchError = useSignal<string | null>(null);
  // Visitor timezone — read once on mount. Used to re-format the
  // date/time labels in the visitor's local TZ.
  const guestTz = useSignal<string>("");
  // True once the island has mounted. Used to gate visitor-TZ
  // re-formatting (so SSR markup stays host-local for crawlers +
  // no-JS clients — same labels the SSR Picker always showed).
  const mounted = useSignal(false);
  // Inline error from server-side validation (?err=…). Mirrors the
  // SSR error prop, but dismissible so a stale error doesn't haunt
  // the visitor after they edit the form.
  const serverError = useSignal<string | null>(props.error);

  useEffect(() => {
    mounted.value = true;
    try {
      guestTz.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      // Empty fallback — server-side stays host-local.
    }
  }, []);

  // ─── Effects ──────────────────────────────────────────────────────

  // Browser back/forward → sync signals from URL. popstate fires after
  // the URL changes; we re-parse searchParams and update state. We
  // do NOT call pushState here — that would create a loop.
  useEffect(() => {
    function onPop() {
      const u = new URL(globalThis.location.href);
      const d = u.searchParams.get("date");
      const s = u.searchParams.get("slot");
      const m = u.searchParams.get("month");
      date.value = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
      slot.value = s && /^\d{2}:\d{2}$/.test(s) ? s : null;
      if (m && /^\d{4}-\d{2}-\d{2}$/.test(m)) month.value = m;
      // Re-fetch slots for the (possibly new) date so the grid is
      // accurate after back-navigation.
      if (date.value && !slot.value) void fetchSlots(date.value);
      else if (!date.value) slots.value = [];
    }
    globalThis.addEventListener("popstate", onPop);
    return () => globalThis.removeEventListener("popstate", onPop);
  }, []);

  // ─── Fetch /api/slots ────────────────────────────────────────────

  // Request token: increments on every fetch call. The handler
  // compares its captured token against the current one before
  // committing results — if a newer fetch has been kicked off, the
  // older response is discarded. Without this, rapid date picks
  // (A then B with A responding slower than B) leave `slots.value`
  // showing A's slots while `date.value === B`. Server Zod catches
  // any actual booking attempt, but the UX is misleading.
  let slotsReqToken = 0;

  async function fetchSlots(forDate: string): Promise<void> {
    const myToken = ++slotsReqToken;
    loading.value = true;
    fetchError.value = null;
    try {
      const r = await fetch(`/api/slots?date=${encodeURIComponent(forDate)}`, {
        headers: { accept: "application/json" },
      });
      if (myToken !== slotsReqToken) return; // superseded
      if (!r.ok) {
        fetchError.value = "Could not load times. Please try again.";
        return;
      }
      const body = await r.json() as { slots?: SlotCell[] };
      if (myToken !== slotsReqToken) return; // superseded between ok + json
      slots.value = Array.isArray(body.slots) ? body.slots : [];
    } catch {
      if (myToken !== slotsReqToken) return;
      fetchError.value = "Network error. Please try again.";
    } finally {
      if (myToken === slotsReqToken) loading.value = false;
    }
  }

  // ─── URL sync ────────────────────────────────────────────────────

  function pushUrl(next: {
    date: string | null;
    slot?: string | null;
    month?: string;
  }): void {
    const params = new URLSearchParams();
    if (next.date) params.set("date", next.date);
    if (next.slot) params.set("slot", next.slot);
    if (next.month) params.set("month", next.month);
    const qs = params.toString();
    const url = qs ? `/?${qs}` : "/";
    if (globalThis.location.pathname + globalThis.location.search !== url) {
      globalThis.history.pushState({}, "", url);
    }
  }

  // ─── Handlers ────────────────────────────────────────────────────

  function onSelectDate(d: string): void {
    if (date.value === d) return;
    date.value = d;
    slot.value = null;
    serverError.value = null;
    pushUrl({ date: d });
    void fetchSlots(d);
  }

  function onSelectMonth(m: string): void {
    if (month.value === m) return;
    month.value = m;
    pushUrl({ date: date.value, slot: slot.value, month: m });
  }

  function onSelectSlot(d: string, s: string): void {
    date.value = d;
    slot.value = s;
    serverError.value = null;
    pushUrl({ date: d, slot: s });
    // Scroll the booking form into view smoothly. setTimeout gives
    // the new section a tick to render before we measure.
    globalThis.setTimeout(() => {
      document.getElementById("step-details")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 30);
  }

  function clearDate(): void {
    date.value = null;
    slot.value = null;
    slots.value = [];
    serverError.value = null;
    pushUrl({ date: null, slot: null });
  }

  function clearSlot(): void {
    slot.value = null;
    serverError.value = null;
    pushUrl({ date: date.value, slot: null });
  }

  // ─── Derived labels (visitor TZ after hydration) ────────────────

  const displayTz = (mounted.value && guestTz.value) ? guestTz.value : hostTz;

  const dateLabel: string | null = date.value
    ? formatDateLongInTz(date.value, "12:00", hostTz, displayTz)
    : null;

  const dateLabelShort: string | null = date.value
    ? formatDateShortInTz(date.value, "12:00", hostTz, displayTz)
    : null;

  // Slot time in visitor TZ. The slot grid is rendered in host TZ
  // (HH:MM strings are host-local by definition), but once the user
  // picks one, we display it in the visitor's TZ on the confirm
  // button + TimeCard to match the visitor's local clock.
  const slotLabelVisitorTz: string | null = date.value && slot.value
    ? formatTimeInTz(date.value, slot.value, hostTz, displayTz)
    : null;

  const confirmLabel: string | null = date.value && slot.value
    ? formatConfirmLabelWithTime(
      date.value,
      slot.value,
      hostTz,
      displayTz,
      slotLabelVisitorTz ?? slot.value,
    )
    : null;

  // ─── Render ──────────────────────────────────────────────────────

  const hasDate = !!date.value;
  const hasSlot = !!slot.value;

  // Error banner: serverError (from ?err=… redirect) OR fetchError
  // (slots fetch failed). Both shown inline so the user knows the
  // picker is in a degraded state.
  const error = serverError.value ?? fetchError.value;

  // Gate the interactive handlers on mounted.value. On the SSR pass
  // (and in any pre-hydration render) mounted is false, so Calendar
  // / TimeSlots / DateCard / TimeCard render their <a href="…">
  // fallbacks — no-JS users can still navigate the picker via the
  // URL. After hydration we re-render with the handlers attached,
  // which swaps <a> → <button>. The DOM swap happens once, on mount,
  // and is invisible to the user (the SSR + hydrated JSX only differ
  // by element type, not by position or content).
  const interactive = mounted.value;

  return (
    <div class="space-y-5 sm:space-y-7">
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
                date={date.value!}
                dateLabel={dateLabel ?? date.value!}
                onClear={interactive ? clearDate : undefined}
              />
            )
            : (
              <Calendar
                monthAnchor={month.value}
                minDate={minDate(props.dates, hostTz)}
                maxDate={maxDate(props.dates, hostTz)}
                slotsByDate={slotsByDate(props.dates)}
                selectedDate={null}
                hostTz={hostTz}
                onSelectDate={interactive ? onSelectDate : undefined}
                onSelectMonth={interactive ? onSelectMonth : undefined}
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
                  date={date.value!}
                  slot={slot.value!}
                  dateLabel={dateLabel ?? date.value!}
                  displaySlot={slotLabelVisitorTz ?? undefined}
                  onClear={interactive ? clearSlot : undefined}
                />
              )
              : loading.value
              ? (
                <div class="rounded-2xl border border-line bg-surface-raised px-5 py-10 text-center">
                  <p class="text-sm text-ink-muted">Loading times…</p>
                </div>
              )
              : slots.value.length > 0
              ? (
                <TimeSlots
                  date={date.value!}
                  dateLabel={dateLabel ?? date.value!}
                  slots={slots.value}
                  selectedSlot={null}
                  onSelectSlot={interactive ? onSelectSlot : undefined}
                />
              )
              : (
                <div class="rounded-2xl border border-line bg-surface-raised px-5 py-10 text-center">
                  <p class="text-sm text-ink-muted">
                    No available times on {dateLabel ?? date.value}.
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
              date={date.value!}
              slot={slot.value!}
              dateLabel={dateLabel ?? date.value!}
              durationMin={props.durationMin}
              hostName={props.hostName}
              error={null}
              confirmLabel={confirmLabel ?? `Confirm — ${slot.value}`}
            />
          </div>
        </section>
      )}

      {
        /* Mobile sticky CTA — appears only between date-pick and
          slot-pick (SummaryBar handles `state === "date"` by hiding
          itself on step 3 already). Renders inside the island so the
          date label updates to visitor TZ after hydration. */
      }
      <SummaryBar
        state={hasSlot ? "slot" : hasDate ? "date" : "none"}
        date={date.value}
        dateLabel={dateLabelShort ?? dateLabel}
        slot={slotLabelVisitorTz ?? slot.value}
      />
    </div>
  );
}

// ─── Static helpers (local to this file) ─────────────────────────────

function slotsByDate(dates: DateCell[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dates) out[d.date] = d.slots;
  return out;
}

function minDate(dates: DateCell[], hostTz: string): string {
  let min = "";
  for (const d of dates) if (!min || d.date < min) min = d.date;
  // Fallback should never hit (getCandidateDates always returns ≥1
  // entry), but use host-TZ today if it ever does — UTC would be
  // off-by-one near midnight in the host's TZ.
  return min || isoDateInTz(new Date(), hostTz);
}

function maxDate(dates: DateCell[], hostTz: string): string {
  let max = "";
  for (const d of dates) if (!max || d.date > max) max = d.date;
  return max || isoDateInTz(new Date(), hostTz);
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
