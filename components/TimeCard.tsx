/*
  TimeCard — compact summary of the selected time slot.

  Shown in place of the full TimeSlots grid once a slot is picked.
  Same visual contract as DateCard so the swap reads as a deliberate
  progression, not a state change.
*/

import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { IconClock } from "@spy4x/preact-icons"
import { pickerHref } from "../lib/picker-links.ts"

interface TimeCardProps {
  date: string // YYYY-MM-DD (host-local)
  slot: string // HH:MM in host TZ
  dateLabel: string // "Friday, 28 August 2026"
  /** Optional override for the displayed slot time (e.g. visitor-TZ
   *  HH:MM). Falls back to `slot` (host TZ) when omitted. The `slot`
   *  prop stays the source of truth for the URL / POST body. */
  displaySlot?: string
  /** Called when the Change link is clicked. When provided, Change is
   *  a <button>; otherwise it stays an <a href> for the no-JS /
   *  /embed fallback, built from `basePath`. */
  onClear?: () => void
  /** "" for the standalone page, "/embed" for the iframe variant.
   *  Defaults to "". */
  basePath?: string
  /** The visitor's IANA zone, once known (mig#15) — threaded onto the
   *  Change link so /embed's tz query param survives. */
  tz?: string | null
  /** /embed's forced theme, once known (mig#44) — threaded onto the
   *  Change link so /embed's theme query param survives. `null` for
   *  "auto" (the default), which adds nothing to the link. */
  theme?: string | null
}

export function TimeCard(
  { date, slot, dateLabel, displaySlot, onClear, basePath = "", tz, theme }:
    TimeCardProps,
) {
  const shownSlot = displaySlot ?? slot
  return (
    <Card class="flex items-center justify-between gap-3 py-1 ps-4 pe-2">
      <div class="flex min-w-0 items-center gap-3">
        <IconClock class="size-5 text-muted" />
        <p class="min-w-0 text-sm tabular-nums">
          <span class="block truncate font-medium text-foreground">
            {shownSlot}
          </span>
          <span class="block truncate text-muted" data-slot-date="">
            {dateLabel}
          </span>
        </p>
      </div>
      {onClear
        ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            aria-label="Change time"
            class={CHANGE}
          >
            Change
          </Button>
        )
        : (
          <Button
            href={pickerHref(basePath, { date }, tz, theme)}
            variant="ghost"
            size="sm"
            // Fresh would mark this link to the page's own path as
            // current (mig#50, see SlotButton in TimeSlots.tsx).
            aria-current="false"
            aria-label="Change time"
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
