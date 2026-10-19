/*
  DateCard — compact summary of the selected date.

  Shown in place of the full Calendar once a date is picked. Mirrors
  the calendar's visual language (rounded card, brand icon, change
  link) so the swap doesn't feel jarring.

  The Change link goes back to the picker root (no date param), which
  the booking flow reads as "show the calendar again".
*/

import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { IconCalendar } from "@spy4x/preact-icons"
import { pickerHref } from "../lib/picker-links.ts"

interface DateCardProps {
  date: string // YYYY-MM-DD (host-local)
  dateLabel: string // pre-formatted "Friday, 28 August 2026"
  /** Called when the Change link is clicked. When provided, Change is
   *  a <button> with onClick (no navigation, no SSR roundtrip). When
   *  omitted, Change is an <a href> for the no-JS / /embed fallback,
   *  built from `basePath`. */
  onClear?: () => void
  /** "" for the standalone page (Change → "/"), "/embed" for the
   *  iframe variant (Change → "/embed"). Defaults to "". */
  basePath?: string
  /** The visitor's IANA zone, once known (mig#15) — threaded onto the
   *  Change link so /embed's tz query param survives. */
  tz?: string | null
  /** /embed's forced theme, once known (mig#44) — threaded onto the
   *  Change link so /embed's theme query param survives. `null` for
   *  "auto" (the default), which adds nothing to the link. */
  theme?: string | null
}

export function DateCard(
  { dateLabel, onClear, basePath = "", tz, theme }: DateCardProps,
) {
  return (
    <Card class="flex items-center justify-between gap-3 py-1 ps-4 pe-2">
      <div class="flex min-w-0 items-center gap-3">
        <IconCalendar class="size-5 text-muted" />
        <p
          class="min-w-0 truncate text-sm font-medium text-foreground tabular-nums"
          data-date-label=""
        >
          {dateLabel}
        </p>
      </div>
      {onClear
        ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            aria-label="Change date"
            class={CHANGE}
          >
            Change
          </Button>
        )
        : (
          <Button
            href={pickerHref(basePath, undefined, tz, theme)}
            variant="ghost"
            size="sm"
            // Fresh would mark this link to the page's own path as
            // current (mig#50, see SlotButton in TimeSlots.tsx).
            aria-current="false"
            aria-label="Change date"
            class={CHANGE}
          >
            Change
          </Button>
        )}
    </Card>
  )
}

/** "Change": a ghost button, 44 px tall on a phone and 36 px with a pointer. */
const CHANGE = "shrink-0 min-h-11 sm:min-h-9"
