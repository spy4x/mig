// Dates for tests that need a slot mig still offers. A literal date
// lands in the past one day and its slots stop rendering as bookable,
// so these are computed from whenever the suite runs. Test-only: no
// production module imports this file.

import { addDays, dayOfWeek, isoDateInTz } from "@spy4x/time/tz";

/** A weekday at least `daysAhead` days out in `tz`, so it clears the
 *  minimum notice and lands inside MON-FRI availability whichever day
 *  the suite runs on. */
export function futureWeekday(daysAhead: number, tz: string): string {
  let d = addDays(isoDateInTz(new Date(), tz), daysAhead, tz);
  while (dayOfWeek(d, tz) === "SAT" || dayOfWeek(d, tz) === "SUN") {
    d = addDays(d, 1, tz);
  }
  return d;
}
