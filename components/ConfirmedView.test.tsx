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

Deno.test("the cancelled page shows what the canceller wrote", () => {
  const html = render({
    mode: "cancelled",
    booking: { ...BOOKING, cancelledReason: "Something came up." },
  })
  assert(html.includes("This booking was cancelled"))
  assert(html.includes("Something came up."), "expected the reason")
})

Deno.test("the cancelled page without a reason shows no empty quote", () => {
  const html = render({ mode: "cancelled" })
  assertFalse(html.includes("“"), "no quote marks around nothing")
})

Deno.test("a missing, tampered or unknown link gets one message and a way to book", () => {
  for (const state of ["missing", "invalid", "expired"] as const) {
    const html = render({ state, booking: null })
    assert(
      /We couldn(&#39;|')t find this booking\. Check the link in your email\./
        .test(html),
      `${state}: ${html}`,
    )
    assertEquals(
      html.match(/<a\b[^>]*href="\/"[^>]*>Book a time<\/a>/)?.length,
      1,
      state,
    )
  }
})
