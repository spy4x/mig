// A booking saved before mig#57 with a date or time that does not exist
// still opens and cancels: /confirmed, /cancel and POST /api/cancel,
// including the cancellation emails.

import { assert, assertEquals } from "@std/assert"
import { renderToString } from "preact-render-to-string"
import type { Context, PageProps } from "fresh"
import type { State } from "../../lib/utils.ts"
import type { Booking, Config } from "../../lib/types.ts"
import { BookingsStore } from "../../lib/bookings.ts"
import { MemoryRateLimiter } from "@spy4x/platform/rate-limit/memory"
import { parseWeeklyAvailability } from "../../lib/availability.ts"
import { newOpaqueToken } from "@spy4x/platform/tokens"
import { setTransportForTesting } from "../../lib/email.ts"
import { loadConfirmedData } from "../../lib/confirmed-data.ts"
import CancelPage, { handler as cancelPage } from "../cancel.tsx"
import { ConfirmedView } from "../../components/ConfirmedView.tsx"
import { handler } from "./cancel.ts"
import { tempDataFile } from "../../lib/test-temp.ts"
import { NOTES_MAX_LENGTH } from "../../lib/validators.ts"
import { handleBookingSubmit, MAX_BOOKING_BODY_BYTES } from "../../lib/book.ts"
import { futureWeekday } from "../../lib/test-dates.ts"
import { fakeCalDav, TEST_CALDAV } from "../../lib/test-caldav.ts"

const SECRET = "fake-cancel-secret-only-for-tests"

function fakeConfig(): Config {
  return {
    hostName: "Jane Doe",
    hostEmail: "jane@example.com",
    hostTz: "Europe/Berlin",
    meetingUrl: "https://meet.example.com/room",
    publicUrl: "https://mig.example.com",
    weeklyAvailability: parseWeeklyAvailability("MON-FRI 09:00-17:00"),
    slotDurationMin: 30,
    minNoticeHours: 6,
    bookingHorizonDays: 60,
    blockedDates: new Set<string>(),
    rateLimitPer5Min: 10,
    theme: "auto",
    smtp: {
      host: "smtp.example.com",
      port: 587,
      user: "jane@example.com",
      pass: "not-a-real-secret",
      from: "Bookings <book@example.com>",
    },
    cancelSecret: SECRET,
    port: 8080,
    dataPath: "/tmp/mig-api-cancel-test-unused.json",
    hideBranding: false,
    githubUrl: "https://github.com/spy4x/mig",
    version: "test",
  }
}

// On main, POST /api/book accepted date=2027-02-30 and slot=10:60 and
// told the visitor Tuesday 2 March 2027, 11:00. The record on disk kept
// the impossible values.
Deno.test("mig#57: a booking stored with an impossible date still opens and cancels, emails included", async () => {
  const cfg = fakeConfig()
  await using file = await tempDataFile()
  const path = file.path
  const { raw, hash } = await newOpaqueToken(SECRET)
  const stored: Booking = {
    id: "01JIMPOSSIBLEDATE00000000",
    createdAt: "2026-09-01T10:00:00.000Z",
    date: "2027-02-30",
    time: "10:60",
    hostTz: "Europe/Berlin",
    guestName: "Visitor",
    guestEmail: "visitor@example.com",
    cancelTokenHash: hash,
    status: "active",
  }
  await Deno.writeTextFile(path, JSON.stringify([stored]))
  const subjects: string[] = []
  setTransportForTesting({
    sendMail(message) {
      subjects.push(String(message.subject))
      return Promise.resolve({})
    },
  })

  try {
    const bookings = new BookingsStore({ filePath: path })
    await bookings.init()
    const state = {
      config: cfg,
      bookings,
      rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
    }
    const query = `id=${stored.id}&token=${raw}`

    const confirmed = await loadConfirmedData(
      {
        req: new Request(`http://localhost/confirmed?${query}`),
        state,
      } as unknown as Context<State>,
    )
    assertEquals(confirmed.state, "ok")
    assertEquals(confirmed.booking?.date, "2027-03-02")
    assertEquals(confirmed.booking?.time, "11:00")

    const cancelGet = await cancelPage.GET!(
      {
        req: new Request(`http://localhost/cancel?${query}`),
        state,
      } as unknown as Context<State>,
    )
    const data = (cancelGet as unknown as { data: unknown }).data
    const html = renderToString(
      <CancelPage
        {...({
          data,
          state,
          url: new URL(`http://localhost/cancel?${query}`),
        } as unknown as PageProps<never, State>)}
      />,
    )
    assert(html.includes("Tuesday, 2 March 2027"), "cancel page date")

    const form = new URLSearchParams({ id: stored.id, token: raw })
    const res = await handler.POST!(
      {
        req: new Request("http://localhost/api/cancel", {
          method: "POST",
          body: form,
        }),
        state,
      } as unknown as Context<State>,
    ) as Response

    assertEquals(res.status, 303)
    assertEquals(
      new URL(res.headers.get("location")!).searchParams.get("cancelled"),
      "1",
    )
    assertEquals(bookings.get(stored.id)?.status, "cancelled")
    assertEquals(subjects.length, 2)
    assert(
      subjects.every((s) => s.includes("Tue 2 Mar 11:00")),
      subjects.join(" | "),
    )
  } finally {
    setTransportForTesting({ sendMail: () => Promise.resolve({}) })
  }
})

// mig#73: cancel links are minted and checked by @spy4x/platform/tokens
// now, not by mig's own lib/tokens.ts. A link already in a guest's inbox
// carries a raw token whose hash the old code stored, so /confirmed and
// POST /api/cancel must accept exactly what the old code wrote.
//
// Captured on origin/main at 19ef6b4 by running lib/tokens.ts's
// newCancelToken(secret) once. The secret is a test fixture, not a real
// one, and is 38 characters, as the new 32-character minimum requires.
const OLD_LINK = {
  secret: "test-cancel-secret-not-real-0123456789",
  raw: "ognPt508-hJgz9bmhInMMw",
  hash: "0634781f3e8d9e639d865217c8d729cf9a12cb5e2c9437043c2c81facdfc1c69",
}

async function withOldLinkBooking(
  secret: string,
  fn: (state: State, id: string) => Promise<void>,
): Promise<void> {
  await using file = await tempDataFile()
  const path = file.path
  const stored: Booking = {
    id: "01JOLDCANCELLINK000000000",
    createdAt: "2026-09-01T10:00:00.000Z",
    date: "2027-03-02",
    time: "11:00",
    hostTz: "Europe/Berlin",
    guestName: "Visitor",
    guestEmail: "visitor@example.com",
    cancelTokenHash: OLD_LINK.hash,
    status: "active",
  }
  await Deno.writeTextFile(path, JSON.stringify([stored]))
  const bookings = new BookingsStore({ filePath: path })
  await bookings.init()
  await fn({
    config: { ...fakeConfig(), cancelSecret: secret },
    bookings,
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
  } as State, stored.id)
}

Deno.test("a cancel link minted by the old lib/tokens.ts still opens /confirmed and cancels", async () => {
  await withOldLinkBooking(OLD_LINK.secret, async (state, id) => {
    const query = `id=${id}&token=${OLD_LINK.raw}`
    const confirmed = await loadConfirmedData(
      {
        req: new Request(`http://localhost/confirmed?${query}`),
        state,
      } as unknown as Context<State>,
    )
    assertEquals(confirmed.state, "ok")

    const res = await handler.POST!(
      {
        req: new Request("http://localhost/api/cancel", {
          method: "POST",
          body: new URLSearchParams({ id, token: OLD_LINK.raw }),
        }),
        state,
      } as unknown as Context<State>,
    ) as Response
    assertEquals(res.status, 303)
    assertEquals(state.bookings.get(id)?.status, "cancelled")
  })
})

Deno.test("an old cancel link is refused once CANCEL_SECRET changes", async () => {
  await withOldLinkBooking(
    "another-cancel-secret-not-real-0123456789",
    async (state, id) => {
      const confirmed = await loadConfirmedData(
        {
          req: new Request(
            `http://localhost/confirmed?id=${id}&token=${OLD_LINK.raw}`,
          ),
          state,
        } as unknown as Context<State>,
      )
      assertEquals(confirmed.state, "invalid")
    },
  )
})

// mig#110: new bookings get a UUID version 7, and the ones already in
// the data file keep the ULID they were stored with. The id below is a
// real ULID, 26 Crockford base32 characters, as @spy4x/platform/tokens'
// monotonicUlid() wrote them.
Deno.test("mig#110: a booking stored with a ULID id still opens /confirmed and /cancel, and cancels", async () => {
  await using file = await tempDataFile()
  const { raw, hash } = await newOpaqueToken(SECRET)
  const stored: Booking = {
    id: "01JA4V5W6X7Y8Z9A0B1C2D3E4F",
    createdAt: "2026-09-01T10:00:00.000Z",
    date: "2027-03-02",
    time: "11:00",
    hostTz: "Europe/Berlin",
    guestName: "Visitor",
    guestEmail: "visitor@example.com",
    cancelTokenHash: hash,
    status: "active",
  }
  await Deno.writeTextFile(file.path, JSON.stringify([stored]))
  setTransportForTesting({ sendMail: () => Promise.resolve({}) })
  const bookings = new BookingsStore({ filePath: file.path })
  await bookings.init()
  const state = {
    config: fakeConfig(),
    bookings,
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
  }
  const query = `id=${stored.id}&token=${raw}`

  const confirmed = await loadConfirmedData(
    {
      req: new Request(`http://localhost/confirmed?${query}`),
      state,
    } as unknown as Context<State>,
  )
  assertEquals(confirmed.state, "ok")
  assertEquals(confirmed.booking?.id, stored.id)

  const cancelGet = await cancelPage.GET!(
    {
      req: new Request(`http://localhost/cancel?${query}`),
      state,
    } as unknown as Context<State>,
  )
  const data = (cancelGet as unknown as {
    data: { state: string; booking?: { id: string } }
  }).data
  assertEquals(data.state, "ok")
  assertEquals(data.booking?.id, stored.id)

  const res = await handler.POST!(
    {
      req: new Request("http://localhost/api/cancel", {
        method: "POST",
        body: new URLSearchParams({ id: stored.id, token: raw }),
      }),
      state,
    } as unknown as Context<State>,
  ) as Response
  assertEquals(res.status, 303)
  const location = new URL(res.headers.get("location")!)
  assertEquals(location.searchParams.get("cancelled"), "1")
  assertEquals(location.searchParams.get("id"), stored.id)
  assertEquals(bookings.get(stored.id)?.status, "cancelled")
})

// mig#108: the form's maxlength is a browser's promise only. A request
// written by hand carried a 200,000-character reason into the stored
// booking and into a 400 KB mail.
Deno.test("mig#108: a cancel reason over the notes limit is cut before it is stored or mailed", async () => {
  const mails: { to: string; text: string; html: string }[] = []
  setTransportForTesting({
    sendMail(message) {
      mails.push({
        to: String(message.to),
        text: String(message.text),
        html: String(message.html),
      })
      return Promise.resolve({})
    },
  })
  try {
    await withOldLinkBooking(OLD_LINK.secret, async (state, id) => {
      // 499 letters, then an emoji whose two code units straddle the
      // limit, then far more than fits. The whole body stays under the
      // route's 64 KiB cap (mig#113), which answers 413 above it.
      const kept = "r".repeat(NOTES_MAX_LENGTH - 1)
      const reason = `  ${kept}\u{1F600}${"X".repeat(20_000)}`
      const res = await handler.POST!(
        {
          req: new Request("http://localhost/api/cancel", {
            method: "POST",
            body: new URLSearchParams({ id, token: OLD_LINK.raw, reason }),
          }),
          state,
        } as unknown as Context<State>,
      ) as Response

      assertEquals(res.status, 303)
      assertEquals(state.bookings.get(id)?.status, "cancelled")
      assertEquals(state.bookings.get(id)?.cancelledReason, kept)

      assertEquals(mails.map((m) => m.to), [
        "visitor@example.com",
        "jane@example.com",
      ])
      const [guest, owner] = mails
      assert(owner.text.includes(`Reason: ${kept}\n`), "owner's reason")
      for (const mail of mails) {
        assertEquals(mail.text.includes("X"), false, `text to ${mail.to}`)
        assertEquals(mail.html.includes("XX"), false, `html to ${mail.to}`)
      }
      assertEquals(guest.text.includes("rrr"), false, "guest's mail")
      assertEquals(guest.html.includes("rrr"), false, "guest's mail")
    })
  } finally {
    setTransportForTesting({ sendMail: () => Promise.resolve({}) })
  }
})

// mig#108, mig#119: anyone can book with someone else's address and
// cancel with the guest link they get back, so the reason a canceller
// typed must never reach a page the address owner opens from their mail.
Deno.test("mig#108: the cancelled /confirmed page never shows the reason the canceller typed", async () => {
  setTransportForTesting({ sendMail: () => Promise.resolve({}) })
  await withOldLinkBooking(OLD_LINK.secret, async (state, id) => {
    const reason = "Typed by a stranger"
    const res = await handler.POST!(
      {
        req: new Request("http://localhost/api/cancel", {
          method: "POST",
          body: new URLSearchParams({ id, token: OLD_LINK.raw, reason }),
        }),
        state,
      } as unknown as Context<State>,
    ) as Response
    assertEquals(res.status, 303)
    assertEquals(state.bookings.get(id)?.cancelledReason, reason)

    const confirmed = await loadConfirmedData(
      {
        req: new Request(
          `http://localhost/confirmed?id=${id}&token=${OLD_LINK.raw}`,
        ),
        state,
      } as unknown as Context<State>,
    )
    assertEquals(confirmed.mode, "cancelled")
    assert(!JSON.stringify(confirmed).includes(reason), "not in the page data")
    const html = renderToString(
      <ConfirmedView
        {...confirmed}
        hostName="Jane Doe"
        meetingUrl="https://meet.example.com/room"
        slotDurationMin={30}
        backHref="/"
      />,
    )
    assert(html.includes("This booking was cancelled"), html)
    assert(!html.includes(reason), "not on the page")
  })
})

// mig#113: the route read the whole body into memory before it looked at
// anything, so a few very large posts could push the one process out of
// memory. It now reads with the booking route's 64 KiB cap.
Deno.test("mig#113: POST /api/cancel refuses a body over the cap with 413 before reading it all", async () => {
  await using file = await tempDataFile()
  const bookings = new BookingsStore({ filePath: file.path })
  await bookings.init()
  const chunk = new TextEncoder().encode("x".repeat(16 * 1024))
  const total = 64 * chunk.length
  let pulled = 0
  // No `id`, no `token`, no Content-Length: only the running byte count
  // can stop this body.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= total) return controller.close()
      pulled += chunk.length
      controller.enqueue(chunk)
    },
  })
  const res = await handler.POST!(
    {
      req: new Request("http://localhost/api/cancel", {
        method: "POST",
        body,
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      state: {
        config: fakeConfig(),
        bookings,
        rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
      },
    } as unknown as Context<State>,
  ) as Response

  assertEquals(res.status, 413)
  assert(
    pulled <= MAX_BOOKING_BODY_BYTES + 2 * chunk.length,
    `read ${pulled} of ${total} bytes`,
  )
})

/** Books one slot through the real booking route and returns the cancel
 *  link from each recipient's mail, plus the state both routes share. */
async function bookThroughRoute(path: string): Promise<{
  state: State
  id: string
  guestLink: URL
  ownerLink: URL
  mails: { to: string; text: string }[]
}> {
  const mails: { to: string; text: string }[] = []
  setTransportForTesting({
    sendMail(message) {
      mails.push({ to: String(message.to), text: String(message.text) })
      return Promise.resolve({})
    },
  })
  const bookings = new BookingsStore({ filePath: path })
  await bookings.init()
  const state = {
    config: fakeConfig(),
    bookings,
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
  } as State
  const res = await handleBookingSubmit(
    {
      req: new Request("http://localhost/api/book", {
        method: "POST",
        body: new URLSearchParams({
          name: "Visitor",
          email: "visitor@example.com",
          notes: "",
          date: futureWeekday(3, "Europe/Berlin"),
          slot: "10:00",
          website: "",
        }),
      }),
      info: {
        remoteAddr: { transport: "tcp", hostname: "192.0.2.1", port: 40100 },
      },
      state,
    } as unknown as Context<State>,
    "",
  )
  assertEquals(new URL(res.headers.get("location")!).pathname, "/confirmed")
  const linkIn = (to: string) => {
    const text = mails.find((m) => m.to === to)?.text ?? ""
    const m = /https:\/\/mig\.example\.com\/cancel\?\S+/.exec(text)
    if (!m) throw new Error(`no cancel link in the mail to ${to}`)
    return new URL(m[0])
  }
  const guestLink = linkIn("visitor@example.com")
  const ownerLink = linkIn("jane@example.com")
  mails.length = 0
  return {
    state,
    id: guestLink.searchParams.get("id")!,
    guestLink,
    ownerLink,
    mails,
  }
}

async function cancelWith(state: State, link: URL): Promise<Response> {
  return await handler.POST!(
    {
      req: new Request("http://localhost/api/cancel", {
        method: "POST",
        body: new URLSearchParams({
          id: link.searchParams.get("id")!,
          token: link.searchParams.get("token")!,
        }),
      }),
      state,
    } as unknown as Context<State>,
  ) as Response
}

// mig#113: both mails carried the same link, so a cancellation through
// the owner's mail told the guest "Cancelled by: you".
Deno.test("mig#113: cancelling through the owner's link is recorded and mailed as the owner's", async () => {
  await using file = await tempDataFile()
  try {
    const { state, id, guestLink, ownerLink, mails } = await bookThroughRoute(
      file.path,
    )
    assert(
      guestLink.searchParams.get("token") !==
        ownerLink.searchParams.get("token"),
      "the two mails carry different tokens",
    )
    const confirmed = await loadConfirmedData(
      {
        req: new Request(`http://localhost/confirmed${ownerLink.search}`),
        state,
      } as unknown as Context<State>,
    )
    assertEquals(confirmed.state, "ok")

    const res = await cancelWith(state, ownerLink)

    assertEquals(res.status, 303)
    assertEquals(state.bookings.get(id)?.status, "cancelled")
    assertEquals(state.bookings.get(id)?.cancelledBy, "owner")
    const guest = mails.find((m) => m.to === "visitor@example.com")!.text
    const owner = mails.find((m) => m.to === "jane@example.com")!.text
    assert(guest.includes("Cancelled by: Jane Doe"), guest)
    assert(owner.includes("Cancelled by: you"), owner)
  } finally {
    setTransportForTesting({ sendMail: () => Promise.resolve({}) })
  }
})

Deno.test("mig#113: cancelling through the guest's link is recorded and mailed as the guest's", async () => {
  await using file = await tempDataFile()
  try {
    const { state, id, guestLink, mails } = await bookThroughRoute(file.path)

    const res = await cancelWith(state, guestLink)

    assertEquals(res.status, 303)
    assertEquals(state.bookings.get(id)?.cancelledBy, "guest")
    const guest = mails.find((m) => m.to === "visitor@example.com")!.text
    assert(guest.includes("Cancelled by: you"), guest)
  } finally {
    setTransportForTesting({ sendMail: () => Promise.resolve({}) })
  }
})

Deno.test("mig#113: a booking stored without an owner token still cancels, as the guest", async () => {
  await withOldLinkBooking(OLD_LINK.secret, async (state, id) => {
    const res = await cancelWith(
      state,
      new URL(`https://mig.example.com/cancel?id=${id}&token=${OLD_LINK.raw}`),
    )
    assertEquals(res.status, 303)
    assertEquals(state.bookings.get(id)?.cancelledBy, "guest")
  })
})

// mig#113: the redirects pasted `id` and `token` into the address as
// raw text, so a `#` or `&` in either changed where the person landed.
Deno.test("mig#113: the cancel redirect keeps id and token whole and caps their length", async () => {
  await using file = await tempDataFile()
  const bookings = new BookingsStore({ filePath: file.path })
  await bookings.init()
  const state = {
    config: fakeConfig(),
    bookings,
    rateLimiter: new MemoryRateLimiter({ windowMs: 300_000, limit: 10 }),
  } as State
  const post = async (id: string, token: string) =>
    new URL(
      (await handler.POST!(
        {
          req: new Request("http://localhost/api/cancel", {
            method: "POST",
            body: new URLSearchParams({ id, token }),
          }),
          state,
        } as unknown as Context<State>,
      ) as Response).headers.get("location")!,
    )

  const odd = await post("x", "other#frag&token=a b")
  assertEquals(odd.pathname, "/cancel")
  assertEquals(odd.hash, "")
  assertEquals(odd.searchParams.getAll("token"), ["other#frag&token=a b"])
  assertEquals(odd.searchParams.get("id"), "x")

  const long = await post("i".repeat(5000), "t".repeat(5000))
  assertEquals(long.searchParams.get("id"), "i".repeat(100))
  assertEquals(long.searchParams.get("token"), "t".repeat(100))
})

// mig#139: the owner's calendar.
function calendarAnswer(request: { method: string }): Response {
  return request.method === "GET"
    ? new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
      status: 200,
      headers: { ETag: '"etag-1"' },
    })
    : new Response(null, { status: 204 })
}

Deno.test("mig#139: cancelling from either link deletes the booking's calendar event", async () => {
  for (const holder of ["guest", "owner"] as const) {
    await using file = await tempDataFile()
    try {
      const { state, id, guestLink, ownerLink } = await bookThroughRoute(
        file.path,
      )
      state.config = { ...state.config, caldav: TEST_CALDAV }
      using dav = fakeCalDav(calendarAnswer)

      await cancelWith(state, holder === "guest" ? guestLink : ownerLink)

      assertEquals(state.bookings.get(id)?.status, "cancelled", holder)
      const objectUrl = `${TEST_CALDAV.calendarUrl}${id}.ics`
      assertEquals(
        dav.requests.map((r) => `${r.method} ${r.url}`),
        [`GET ${objectUrl}`, `DELETE ${objectUrl}`],
        holder,
      )
    } finally {
      setTransportForTesting({ sendMail: () => Promise.resolve({}) })
    }
  }
})

Deno.test("mig#139: a failed calendar delete still cancels the booking and mails both", async () => {
  await using file = await tempDataFile()
  const originalError = console.error
  console.error = () => {}
  try {
    const { state, id, guestLink, mails } = await bookThroughRoute(file.path)
    state.config = { ...state.config, caldav: TEST_CALDAV }
    using _dav = fakeCalDav(() => new Response(null, { status: 500 }))

    const res = await cancelWith(state, guestLink)

    assertEquals(res.status, 303)
    assertEquals(
      new URL(res.headers.get("location")!).searchParams.get("cancelled"),
      "1",
    )
    assertEquals(state.bookings.get(id)?.status, "cancelled")
    assertEquals(mails.length, 2)
  } finally {
    console.error = originalError
    setTransportForTesting({ sendMail: () => Promise.resolve({}) })
  }
})
