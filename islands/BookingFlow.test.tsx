// mig#119 — the booking flow on the library's parts: where a refused
// booking's message sits, and what a day with no free time offers.

import { assert, assertEquals, assertFalse } from "@std/assert"
import { renderToString } from "preact-render-to-string"
import BookingFlow from "./BookingFlow.tsx"

const BASE = {
  dates: [{ date: "2027-01-04", slots: 2 }],
  selectedSlot: null,
  monthAnchor: "2027-01-01",
  durationMin: 30,
  hostName: "Jane Doe",
  hostTz: "Europe/Berlin",
  tz: null,
}

/** The markup of one step's `<section>`, by its heading id. */
function section(html: string, id: string): string {
  const start = html.indexOf(`<section aria-labelledby="${id}"`)
  assert(start >= 0, `expected the ${id} section`)
  const end = html.indexOf("</section>", start)
  return html.slice(start, end)
}

Deno.test("a slot conflict shows its message in the time step, above the times", () => {
  const html = renderToString(
    <BookingFlow
      {...BASE}
      selectedDate="2027-01-04"
      slots={[
        { time: "09:00", available: false },
        { time: "09:30", available: true },
      ]}
      error="That time was just booked by someone else. Please pick another time."
    />,
  )
  assertFalse(
    section(html, "step-date").includes('role="alert"'),
    "not above the date",
  )
  const time = section(html, "step-time")
  const alert = time.indexOf('role="alert"')
  assert(alert >= 0, "expected the message in the time step")
  assert(time.includes("That time was just booked by someone else."))
  assert(
    alert < time.indexOf("data-grid-day"),
    "the message comes before the times",
  )
  // The taken time is gone; the free one is still offered.
  assertFalse(time.includes(">09:00<"))
  assert(time.includes(">09:30<"))
})

Deno.test("a refused form shows its message in the details step", () => {
  const html = renderToString(
    <BookingFlow
      {...BASE}
      selectedDate="2027-01-04"
      selectedSlot="09:30"
      slots={[{ time: "09:30", available: true }]}
      error="Please enter a valid email."
    />,
  )
  assertFalse(section(html, "step-time").includes('role="alert"'))
  assert(section(html, "step-details").includes('role="alert"'))
})

Deno.test("a day whose every time is taken says so and links back to the calendar", () => {
  const html = renderToString(
    <BookingFlow
      {...BASE}
      selectedDate="2027-01-04"
      slots={[
        { time: "09:00", available: false },
        { time: "09:30", available: false },
      ]}
      error={null}
      basePath="/embed"
    />,
  )
  const time = section(html, "step-time")
  assert(time.includes("No times left on Monday, 4 January 2027."))
  const link = time.match(/<a\b[^>]*>Choose another date<\/a>/)?.[0]
  assert(link, "expected a 'Choose another date' link")
  assertEquals(link.match(/href="([^"]*)"/)?.[1], "/embed")
  assertFalse(time.includes("data-grid-day"), "no empty grid")
})

Deno.test("a booked time does not decide which day the times are under", () => {
  // Berlin host, Tokyo visitor: the booked 15:00 is still Monday in
  // Tokyo, the free 17:00 is already Tuesday. The heading follows the
  // time the visitor can pick, not the one already taken.
  const html = renderToString(
    <BookingFlow
      {...BASE}
      tz="Asia/Tokyo"
      selectedDate="2027-01-04"
      slots={[
        { time: "15:00", available: false },
        { time: "17:00", available: true },
      ]}
      error={null}
    />,
  )
  const heading = section(html, "step-time").match(
    /<h3\b[^>]*\bdata-grid-day=""[^>]*>([^<]*)<\/h3>/,
  )?.[1]
  assertEquals(heading, "Tuesday, 5 January 2027")
})

Deno.test("on a phone, Choose another date and Confirm are at least 44 px tall", () => {
  const empty = renderToString(
    <BookingFlow
      {...BASE}
      selectedDate="2027-01-04"
      slots={[{ time: "09:00", available: false }]}
      error={null}
      basePath="/embed"
    />,
  )
  const choose = empty.match(/<a\b[^>]*>Choose another date<\/a>/)?.[0]
  assert(choose?.includes("min-h-11"), `Choose another date: ${choose}`)

  // The standalone page's island button and /embed's plain one.
  for (const basePath of ["", "/embed"]) {
    const form = renderToString(
      <BookingFlow
        {...BASE}
        selectedDate="2027-01-04"
        selectedSlot="09:30"
        slots={[{ time: "09:30", available: true }]}
        error={null}
        basePath={basePath}
      />,
    )
    const confirm = form.match(/<button\b[^>]*type="submit"[^>]*>/)?.[0]
    assert(
      confirm?.includes("min-h-11"),
      `Confirm on "${basePath}": ${confirm}`,
    )
  }
})
