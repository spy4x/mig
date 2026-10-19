// mig#119 — the booking flow on the library's parts: where a refused
// booking's message sits, and what a day with no free time offers.
// mig#125 — where focus starts, and the empty day's two wordings.

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
  assert(time.includes(">No times left on Monday, 4 January 2027<"), time)
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

/** The opening tag of each step heading, by its id. */
function headings(html: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tag of html.match(/<h2\b[^>]*>/g) ?? []) {
    const id = tag.match(/\bid="([^"]*)"/)?.[1]
    if (id) out[id] = tag
  }
  return out
}

Deno.test("every step heading can take focus without a ring and clears the sticky edge", () => {
  const html = renderToString(
    <BookingFlow
      {...BASE}
      selectedDate="2027-01-04"
      selectedSlot="09:30"
      slots={[{ time: "09:30", available: true }]}
      error={null}
    />,
  )
  const tags = headings(html)
  assertEquals(Object.keys(tags).sort(), [
    "step-date",
    "step-details",
    "step-time",
  ])
  for (const [id, tag] of Object.entries(tags)) {
    assert(tag.includes('tabindex="-1"'), `${id}: ${tag}`)
    assert(tag.includes("outline-hidden"), `${id}: ${tag}`)
    assert(tag.includes("scroll-mt-20"), `${id}: ${tag}`)
  }
  assertFalse(
    /<section\b[^>]*scroll-mt-20/.test(html),
    "the scroll margin is on the heading, not the section",
  )
})

Deno.test("without JavaScript, a page opened on a step starts with focus on its heading", () => {
  const cases: Array<[string | null, string | null, string | null]> = [
    [null, null, null],
    ["2027-01-04", null, "step-time"],
    ["2027-01-04", "09:30", "step-details"],
  ]
  for (const [date, slot, expected] of cases) {
    const html = renderToString(
      <BookingFlow
        {...BASE}
        selectedDate={date}
        selectedSlot={slot}
        slots={[{ time: "09:30", available: true }]}
        error={null}
      />,
    )
    const focused = Object.entries(headings(html))
      .filter(([, tag]) => /\bautofocus\b/.test(tag))
      .map(([id]) => id)
    assertEquals(focused, expected ? [expected] : [], `${date} ${slot}`)
  }
})

Deno.test("a server message about one field shows under it, focused, with no notice", () => {
  for (const field of ["name", "email", "notes"] as const) {
    const html = renderToString(
      <BookingFlow
        {...BASE}
        selectedDate="2027-01-04"
        selectedSlot="09:30"
        slots={[{ time: "09:30", available: true }]}
        error="Enter a name of 100 characters or fewer."
        errorField={field}
      />,
    )
    const details = section(html, "step-details")
    assertFalse(details.includes('role="alert"'), `${field}: no notice`)
    const control = details.match(
      new RegExp(`<(input|textarea)\\b[^>]*\\bid="f-${field}"[^>]*>`),
    )?.[0]
    assert(control, `${field}: expected the control`)
    assert(/\bautofocus\b/.test(control), `${field}: ${control}`)
    const describedBy = control.match(/aria-describedby="([^"]*)"/)?.[1]
    assert(describedBy, `${field}: the message describes the control`)
    const message = details.match(
      new RegExp(`<p\\b[^>]*id="${describedBy.split(" ")[0]}"[^>]*>([^<]*)<`),
    )?.[1]
    assertEquals(message, "Enter a name of 100 characters or fewer.", field)
    assertEquals(
      html.match(/\bautofocus\b/g)?.length,
      1,
      `${field}: only the field takes focus, not the heading`,
    )
  }
})

Deno.test("a message about no field stays in the step's notice", () => {
  const html = renderToString(
    <BookingFlow
      {...BASE}
      selectedDate="2027-01-04"
      selectedSlot="09:30"
      slots={[{ time: "09:30", available: true }]}
      error="Too many attempts. Try again in 5 minutes."
      errorField={null}
    />,
  )
  const details = section(html, "step-details")
  assert(details.includes('role="alert"'))
  assertFalse(/<input\b[^>]*\bautofocus\b/.test(details))
})

Deno.test("a day the host does not work says so, by name, without a period", () => {
  const html = renderToString(
    <BookingFlow {...BASE} selectedDate="2027-01-09" slots={[]} error={null} />,
  )
  const time = section(html, "step-time")
  assert(
    /<h3\b[^>]*>Jane Doe isn(&#39;|')t taking meetings on Saturday, 9 January 2027<\/h3>/
      .test(time),
    time,
  )
  assertFalse(time.includes("No times left"))
  assert(/<a\b[^>]*>Choose another date<\/a>/.test(time))
})
