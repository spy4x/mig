// Pure helper for the standalone time card's date line.
//
// mig#18 round 3: the picker built this label inline in
// islands/BookingFlow.tsx from the slot's own instant (date + the
// picked time, not noon), so a booking near a timezone boundary shows
// the day the visitor's clock actually lands on — the 09:00 Ho Chi
// Minh slot on 2026-09-28 is still 2026-09-27 for a visitor in
// America/New_York. No test guarded that: swapping in a noon-based
// instant left every existing test green, since noon rarely crosses a
// date boundary. Extracted here, as its own pure function, so it can
// be tested directly against the timezone-boundary case.
import { zonedDateTime } from "./tz.ts";

// "Sunday, 27 September 2026" — the host-local `date` + `slotTime`
// pair (as stored on a booking, always host-local), formatted as a
// long calendar date in `displayTz`. Building the instant from
// `slotTime` (not noon) is what makes the date correct across a
// timezone boundary.
export function slotDateLabel(
  date: string,
  slotTime: string,
  hostTz: string,
  displayTz: string,
): string {
  const instant = zonedDateTime(date, slotTime, hostTz);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: displayTz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(instant);
}
