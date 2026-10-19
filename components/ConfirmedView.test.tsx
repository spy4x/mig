// mig#119 — /confirmed's three states on the library's parts.

import { assert, assertEquals, assertFalse } from "@std/assert"
import { renderToString } from "preact-render-to-string"
import { ConfirmedView, type ConfirmedViewProps } from "./ConfirmedView.tsx"
import type { ConfirmedBooking } from "../lib/confirmed-data.ts"

const BOOKING: ConfirmedBooking = {
  id: "01JBOOKINGFAKE00000000000",
  date: "2027-01-04",
  time: "09:00",
  hostTz: "Europe/Berlin",
  guestTz: "Europe/Berlin",
  guestName: "Visitor",
  guestEmail: "visitor@example.com",
  cancelToken: "faketoken",
}

function render(overrides: Partial<ConfirmedViewProps>): string {
  return renderToString(
    <ConfirmedView
      state="ok"
      mode="booked"
      booking={BOOKING}
      hostName="Jane Doe"
      meetingUrl="https://video.example.com/jane"
      slotDurationMin={30}
      backHref="/"
      {...overrides}
    />,
  )
}

Deno.test("the booked page names the host and where the invite went", () => {
  const html = render({})
  assert(html.includes("You&#39;re booked with Jane Doe"), html)
  assert(html.includes("visitor@example.com"))
  assert(html.includes('href="https://video.example.com/jane"'))
  assert(html.includes(">Cancel booking<"))
})

Deno.test("the cancelled page says so and offers a new time", () => {
  const html = render({ mode: "cancelled" })
  assert(html.includes("This booking was cancelled"), html)
  assert(/<a\b[^>]*href="\/"[^>]*>Book a new time<\/a>/.test(html))
})

Deno.test("a missing, tampered or unknown link gets one heading, one message and a way to book", () => {
  for (const state of ["missing", "invalid", "expired"] as const) {
    const html = render({ state, booking: null })
    assert(
      /<h1\b[^>]*>\s*We couldn(&#39;|')t find this booking\s*<\/h1>/.test(html),
      `${state}: the heading names the problem: ${html}`,
    )
    assert(html.includes("Check the link in your email."), state)
    assertEquals(
      html.match(/<a\b[^>]*href="\/"[^>]*>Book a time<\/a>/)?.length,
      1,
      state,
    )
  }
})

Deno.test("on a phone, the not-found and cancelled pages' buttons are at least 44 px tall", () => {
  for (
    const [html, label] of [
      [render({ state: "missing", booking: null }), "Book a time"],
      [render({ mode: "cancelled" }), "Book a new time"],
    ]
  ) {
    const link = html.match(new RegExp(`<a\\b[^>]*>\\s*${label}\\s*</a>`))?.[0]
    assert(link?.includes("min-h-11"), `${label}: ${link}`)
  }
})

// mig#125 — "Skip to content" (routes/_app.tsx, href="#main") lands on
// the page's main content in every state, on /confirmed and /embed/confirmed.
Deno.test("every /confirmed state's main content is the skip link's focusable target", () => {
  const states: Array<[string, Partial<ConfirmedViewProps>]> = [
    ["not found", { state: "missing", booking: null }],
    ["cancelled", { mode: "cancelled" }],
    ["booked", {}],
  ]
  for (const [name, overrides] of states) {
    const main = render(overrides).match(/<main\b[^>]*>/)?.[0] ?? ""
    assert(main.includes('id="main"'), `${name}: ${main}`)
    assert(main.includes('tabindex="-1"'), `${name}: ${main}`)
    assert(main.includes("outline-hidden"), `${name}: ${main}`)
  }
})

Deno.test("the booked page's two buttons sit together: centred from sm, stacked full width on a phone", () => {
  const html = render({})
  const row = html.match(
    /<div class="([^"]*)"><a\b[^>]*>Book another time<\/a><a\b[^>]*>Cancel booking<\/a><\/div>/,
  )
  assert(row, "Book another time, then Cancel booking, side by side in one row")
  const classes = row[1].split(" ")
  for (
    const c of ["flex", "flex-col", "gap-2", "sm:flex-row", "sm:justify-center"]
  ) {
    assert(classes.includes(c), `row: ${row[1]}`)
  }
  assertFalse(classes.includes("sm:justify-between"), row[1])
  for (const label of ["Book another time", "Cancel booking"]) {
    const link = html.match(new RegExp(`<a\\b[^>]*>${label}</a>`))?.[0]
    assert(link?.includes("min-h-11"), `${label}: ${link}`)
    assertFalse(
      /\bw-full\b/.test(link ?? ""),
      `${label} is as wide as its label from sm`,
    )
  }
})
