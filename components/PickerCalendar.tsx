/*
  PickerCalendar — the library's month grid, wired to mig's picker links.

  `Calendar` from @spy4x/preact-system draws the grid, the month arrows
  and the keyboard handling. This wrapper only supplies what is mig's:
  the hrefs of the no-JS / /embed fallback (the visitor's `tz` and
  /embed's `theme` ride along on every link) and mig's card colours.
  With `onSelectDate` the days are buttons; without it they are links.

  The links are query-only ("?date=…"), so they resolve against the
  page they are on, "/" or "/embed". That is deliberate: Fresh marks a
  link that starts with "/" and points at the page's own path as
  current, and the library's links set no `aria-current` of their own
  to stop it (mig#50). A link that starts with "?" it leaves alone; see
  fresh-active-links.test.tsx.
*/

import { Calendar } from "@spy4x/preact-system/calendar";
import { pickerQuery } from "../lib/picker-links.ts";

interface PickerCalendarProps {
  /** YYYY-MM-DD (host-local) — month we anchor on. */
  monthAnchor: string;
  /** YYYY-MM-DD — the first date that can be booked (today + minNotice). */
  minDate: string;
  /** YYYY-MM-DD — the last date that can be booked. */
  maxDate: string;
  /** Map of YYYY-MM-DD → remaining slots (0 = full). Only present for
   *  dates with at least one available time slot. */
  slotsByDate: Record<string, number>;
  selectedDate: string | null;
  hostTz: string;
  onSelectDate?: (date: string) => void;
  onSelectMonth?: (monthAnchor: string) => void;
  /** The visitor's IANA zone, once known (mig#15). */
  tz?: string | null;
  /** /embed's forced theme, once known (mig#44); `null` for "auto". */
  theme?: string | null;
}

export function PickerCalendar(props: PickerCalendarProps) {
  const { tz, theme } = props;
  return (
    <Calendar
      monthAnchor={props.monthAnchor}
      minDate={props.minDate}
      maxDate={props.maxDate}
      availableByDate={props.slotsByDate}
      selectedDate={props.selectedDate}
      timeZone={props.hostTz}
      onSelectDate={props.onSelectDate}
      onSelectMonth={props.onSelectMonth}
      dateHref={(date) => pickerQuery({ date }, tz, theme)}
      monthHref={(month) => pickerQuery({ month }, tz, theme)}
      class="border-subtle bg-surface dark:border-subtle dark:bg-surface"
    />
  );
}
