// Issue #33 — the hovered slot's date note ("Wed 23 Sep") once read
// 4.21:1 because it was faded with an opacity class. Since mig#119 the
// note takes the slot's own text colour, which the library's outline
// button keeps at 4.5:1 or better in both palettes, idle and hovered.

import { assert, assertEquals, assertFalse } from "@std/assert"
import { renderToString } from "preact-render-to-string"
import { App } from "fresh"
import { TimeSlots } from "./TimeSlots.tsx"

Deno.test("renders a slot's date note in the slot's own text colour, never faded", () => {
  const html = renderToString(
    <TimeSlots
      date="2026-09-23"
      dateLabel="Wednesday, 23 September 2026"
      slots={[{
        time: "09:00",
        available: true,
        displayHHMM: "23:00",
        ariaZoneLabel: "Auckland, UTC+13",
        dateNote: "Wed 23 Sep",
      }]}
      onSelectSlot={() => {}}
    />,
  )

  const note = html.match(/<span class="([^"]*)">Wed 23 Sep<\/span>/)
  assert(note, "expected the date note to render in its own span")
  assertFalse(
    /\b(opacity|text)-/.test(note[1].replace(/\btext-xs\b/, "")),
    `the note must inherit the slot's colour, got "${note[1]}"`,
  )
})

Deno.test("renders no date note when the slot's day matches the picked date", () => {
  const html = renderToString(
    <TimeSlots
      date="2026-09-23"
      dateLabel="Wednesday, 23 September 2026"
      slots={[{ time: "09:00", available: true }]}
      onSelectSlot={() => {}}
    />,
  )

  assertFalse(html.includes("Wed 23 Sep"))
})

// ─── mig#48 review: accessible name includes the date note ──────────

Deno.test("a bookable slot's aria-label ends with its date note", () => {
  const html = renderToString(
    <TimeSlots
      date="2026-09-23"
      dateLabel="Wednesday, 23 September 2026"
      slots={[{
        time: "09:00",
        available: true,
        displayHHMM: "23:00",
        ariaZoneLabel: "Auckland, UTC+13",
        dateNote: "Wed 23 Sep",
      }]}
      onSelectSlot={() => {}}
    />,
  )

  assert(
    html.includes('aria-label="23:00, Auckland, UTC+13, Wed 23 Sep"'),
    "expected the accessible name to carry the full clock and the date note",
  )
})

Deno.test("the selected slot's full time is in visually hidden text, not just aria-label", () => {
  const html = renderToString(
    <TimeSlots
      date="2026-09-23"
      dateLabel="Wednesday, 23 September 2026"
      selectedSlot="09:00"
      slots={[{
        time: "09:00",
        available: true,
        displayHHMM: "23:00",
        ariaZoneLabel: "Auckland, UTC+13",
        dateNote: "Wed 23 Sep",
      }]}
    />,
  )

  // aria-label on a plain <span> (no interactive role) isn't reliably
  // exposed — the full time must be in the DOM as visible-but-hidden
  // text instead.
  assertFalse(
    html.includes("aria-label="),
    "expected no aria-label on the selected chip (unreliable on a <span>)",
  )
  assert(
    html.includes('class="sr-only"'),
    "expected a visually hidden element carrying the full time",
  )
  assert(
    /class="sr-only">23:00, Auckland, UTC\+13, Wed 23 Sep</.test(html),
    "expected the hidden text to carry the full clock and date note",
  )
  // The visible chip (bare "23:00" + the date note) must itself be
  // `aria-hidden`, or a screen reader would read both it and the
  // `sr-only` text above — announcing the time twice.
  assert(
    /aria-hidden="true"[^>]*>\s*<span>23:00<\/span>/.test(html),
    "expected the visible chip to be aria-hidden (not read twice alongside the sr-only text)",
  )
})

Deno.test("hides a booked slot: neither its time nor a way to pick it is shown", () => {
  // mig#119: a struck-through booked time told every visitor when the
  // host is busy and offered nothing to click, so it is left out.
  const html = renderToString(
    <TimeSlots
      date="2026-09-23"
      dateLabel="Wednesday, 23 September 2026"
      slots={[
        { time: "09:00", available: false, displayHHMM: "09:00" },
        { time: "09:30", available: true, displayHHMM: "09:30" },
      ]}
    />,
  )

  assertFalse(html.includes("09:00"), "the booked time is not on the page")
  assert(html.includes("slot=09%3A30"), "the free time is still a link")
})

// ─── mig#50: Fresh's active-link marking ─────────────────────────────

// Rendered through Fresh's own server renderer (`ctx.render`), not
// `renderToString`: the marking comes from a Preact hook Fresh installs
// for its render only, so a plain `renderToString` never shows it. Every
// slot link points at the page's own path, and Fresh marks such a link
// 'aria-current="true"' + `data-ancestor` unless it already has an
// `aria-current` of its own.
async function renderThroughFresh(path: string): Promise<string> {
  const basePath = path === "/" ? "" : path
  const app = new App().get(path, (ctx) =>
    ctx.render(
      <TimeSlots
        date="2026-11-01"
        dateLabel="Sunday, 1 November 2026"
        slots={[
          { time: "17:00", available: true },
          { time: "18:00", available: true },
          { time: "19:00", available: true },
        ]}
        selectedSlot="18:00"
        basePath={basePath}
      />,
    ))
  const res = await app.handler()(
    new Request(`http://localhost${path}?date=2026-11-01`),
  )
  return await res.text()
}

for (const path of ["/", "/embed"]) {
  Deno.test(`mig#50: on ${path}, only the selected slot is marked current, never a slot link`, async () => {
    const html = await renderThroughFresh(path)
    const links = html.match(/<a [^>]*>/g) ?? []
    assertEquals(links.length, 2, "expected the two unselected slots as links")
    for (const a of links) {
      assertFalse(a.includes('aria-current="true"'), a)
      assertFalse(a.includes('aria-current="page"'), a)
      assertFalse(a.includes("data-ancestor"), a)
      assertFalse(a.includes("data-current"), a)
    }
    const current = html.match(/<[a-z]+ [^>]*aria-current="true"[^>]*>/g) ?? []
    assertEquals(current.length, 1, "expected exactly one current element")
    const [only] = current
    assert(only?.startsWith("<span"), only)
    assert(only?.includes('title="Selected"'), only)
  })
}
