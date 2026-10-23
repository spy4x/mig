import { assert, assertEquals, assertFalse } from "@std/assert"
import {
  addBookingToCalendar,
  CalendarOutcome,
  isAllowedCalendarUrl,
  removeBookingFromCalendar,
} from "./calendar.ts"
import { fakeCalDav, TEST_CALDAV } from "./test-caldav.ts"
import { parseWeeklyAvailability } from "./availability.ts"
import type { Booking, Config } from "./types.ts"

function fakeConfig(caldav: Config["caldav"] = TEST_CALDAV): Config {
  return {
    hostName: "Jane Doe",
    hostEmail: "jane@example.com",
    hostTz: "Europe/Berlin",
    meetingUrl: "https://meet.example.com/room",
    publicUrl: "https://mig.example.com",
    weeklyAvailability: parseWeeklyAvailability("MON-FRI 09:00-17:00"),
    slotDurationMin: 30,
    minNoticeHours: 6,
    bookingHorizonDays: 14,
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
    caldav,
    cancelSecret: "fake-cancel-secret-only-for-tests",
    port: 8080,
    dataPath: "/tmp/mig-calendar-test-unused.json",
    hideBranding: false,
    githubUrl: "https://github.com/spy4x/mig",
    version: "test",
  }
}

const BOOKING: Booking = {
  id: "0199f2a0-0000-7000-8000-000000000001",
  createdAt: "2026-10-23T10:00:00.000Z",
  date: "2026-10-30",
  time: "10:00",
  hostTz: "Europe/Berlin",
  guestTz: "America/New_York",
  guestName: "Sam Guest",
  guestEmail: "sam@example.org",
  notes: "Talk about the roadmap",
  cancelTokenHash: "unused",
  status: "active",
}

const CANCEL_URL = "https://mig.example.com/cancel?id=x&token=owner-token"
const OBJECT_URL = `${TEST_CALDAV.calendarUrl}${BOOKING.id}.ics`

async function captureConsoleError(
  fn: () => Promise<void>,
): Promise<string> {
  const original = console.error
  const lines: string[] = []
  console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "))
  try {
    await fn()
  } finally {
    console.error = original
  }
  return lines.join("\n")
}

Deno.test("a booking is written as <id>.ics with the owner's event, never over an existing one", async () => {
  using dav = fakeCalDav()
  const outcome = await addBookingToCalendar(fakeConfig(), BOOKING, CANCEL_URL)
  assertEquals(outcome, CalendarOutcome.Done)
  assertEquals(dav.requests.length, 1)
  const [put] = dav.requests
  assertEquals(put.method, "PUT")
  assertEquals(put.url, OBJECT_URL)
  assertEquals(put.headers.get("If-None-Match"), "*")
  assertEquals(
    put.headers.get("Authorization"),
    `Basic ${btoa(`${TEST_CALDAV.username}:${TEST_CALDAV.password}`)}`,
  )
  const ics = put.body.replace(/\r\n[ \t]/g, "")
  assert(ics.includes(`UID:${BOOKING.id}@mig`), ics)
  assert(ics.includes("SUMMARY:Meeting with Sam Guest"), ics)
  assert(ics.includes("Guest: Sam Guest <sam@example.org>"), ics)
  assert(ics.includes("Talk about the roadmap"), ics)
  assert(ics.includes(CANCEL_URL), ics)
  assert(ics.includes("DTSTART:20261030T090000Z"), ics)
})

// With an ORGANIZER and an ATTENDEE, a server that does CalDAV
// scheduling (Stalwart) mails the guest an invitation of its own.
Deno.test("the calendar event names no organizer or attendee, so the server mails nobody", async () => {
  using dav = fakeCalDav()
  await addBookingToCalendar(fakeConfig(), BOOKING, CANCEL_URL)
  const ics = dav.requests[0].body
  assertFalse(ics.includes("ORGANIZER"), ics)
  assertFalse(ics.includes("ATTENDEE"), ics)
})

Deno.test("an object already at the booking's name counts as written", async () => {
  using _dav = fakeCalDav(() => new Response(null, { status: 412 }))
  const outcome = await addBookingToCalendar(fakeConfig(), BOOKING, CANCEL_URL)
  assertEquals(outcome, CalendarOutcome.Done)
})

Deno.test("a failed write is reported and logged without the password", async () => {
  using _dav = fakeCalDav(() => new Response("boom", { status: 500 }))
  let outcome: CalendarOutcome | undefined
  const log = await captureConsoleError(async () => {
    outcome = await addBookingToCalendar(fakeConfig(), BOOKING, CANCEL_URL)
  })
  assertEquals(outcome, CalendarOutcome.Failed)
  assert(log.includes(`calendar write FAILED; booking=${BOOKING.id}`), log)
  assert(log.includes("HTTP 500"), log)
  assertFalse(log.includes(TEST_CALDAV.password), log)
})

Deno.test("a cancellation reads the event for its etag and deletes it with that etag", async () => {
  using dav = fakeCalDav((request) =>
    request.method === "GET"
      ? new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
        status: 200,
        headers: { ETag: '"etag-1"' },
      })
      : new Response(null, { status: 204 })
  )
  const outcome = await removeBookingFromCalendar(fakeConfig(), BOOKING)
  assertEquals(outcome, CalendarOutcome.Done)
  assertEquals(
    dav.requests.map((r) => `${r.method} ${r.url}`),
    [`GET ${OBJECT_URL}`, `DELETE ${OBJECT_URL}`],
  )
  assertEquals(dav.requests[1].headers.get("If-Match"), '"etag-1"')
})

Deno.test("an event that is already gone counts as deleted", async () => {
  using dav = fakeCalDav(() => new Response(null, { status: 404 }))
  const outcome = await removeBookingFromCalendar(fakeConfig(), BOOKING)
  assertEquals(outcome, CalendarOutcome.Done)
  assertEquals(dav.requests.map((r) => r.method), ["GET"])
})

Deno.test("an event deleted between the read and the delete counts as deleted", async () => {
  using _dav = fakeCalDav((request) =>
    request.method === "GET"
      ? new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
        status: 200,
        headers: { ETag: '"etag-1"' },
      })
      : new Response(null, { status: 404 })
  )
  const outcome = await removeBookingFromCalendar(fakeConfig(), BOOKING)
  assertEquals(outcome, CalendarOutcome.Done)
})

Deno.test("a failed delete is reported and logged without the password", async () => {
  using _dav = fakeCalDav(() => new Response(null, { status: 401 }))
  let outcome: CalendarOutcome | undefined
  const log = await captureConsoleError(async () => {
    outcome = await removeBookingFromCalendar(fakeConfig(), BOOKING)
  })
  assertEquals(outcome, CalendarOutcome.Failed)
  assert(log.includes(`calendar delete FAILED; booking=${BOOKING.id}`), log)
  assertFalse(log.includes(TEST_CALDAV.password), log)
})

Deno.test("no CalDAV settings means no request, for a booking or a cancellation", async () => {
  using dav = fakeCalDav()
  const cfg = { ...fakeConfig(), caldav: undefined }
  assertEquals(
    await addBookingToCalendar(cfg, BOOKING, CANCEL_URL),
    CalendarOutcome.Off,
  )
  assertEquals(
    await removeBookingFromCalendar(cfg, BOOKING),
    CalendarOutcome.Off,
  )
  assertEquals(dav.requests.length, 0)
})

Deno.test("a calendar URL is https, or http only on a loopback host, and holds no login", () => {
  assert(isAllowedCalendarUrl("https://dav.example.com/dav/cal/jane/"))
  assert(isAllowedCalendarUrl("http://localhost:8080/dav/cal/jane/"))
  assert(isAllowedCalendarUrl("http://127.0.0.1:8080/dav/cal/jane/"))
  assert(isAllowedCalendarUrl("http://[::1]:8080/dav/cal/jane/"))
  assertFalse(isAllowedCalendarUrl("http://dav.example.com/dav/cal/jane/"))
  assertFalse(isAllowedCalendarUrl("https://jane:pw@dav.example.com/dav/"))
  assertFalse(isAllowedCalendarUrl("ftp://dav.example.com/"))
  assertFalse(isAllowedCalendarUrl("not a url"))
})

Deno.test("a failed write or delete pushes an ntfy alert when ntfy is configured", async () => {
  using _dav = fakeCalDav(() => new Response(null, { status: 500 }))
  const originalFetch = globalThis.fetch
  const pushes: string[] = []
  globalThis.fetch = ((_input: unknown, init?: RequestInit) => {
    pushes.push(String(init?.body ?? ""))
    return Promise.resolve(new Response(null, { status: 200 }))
  }) as typeof fetch
  Deno.env.set("NTFY_URL", "https://ntfy.example.com")
  Deno.env.set("NTFY_TOPIC", "mig-test")
  try {
    await captureConsoleError(async () => {
      await addBookingToCalendar(fakeConfig(), BOOKING, CANCEL_URL)
      await removeBookingFromCalendar(fakeConfig(), BOOKING)
    })
  } finally {
    globalThis.fetch = originalFetch
    Deno.env.delete("NTFY_URL")
    Deno.env.delete("NTFY_TOPIC")
  }
  assertEquals(pushes.length, 2)
  assert(pushes[0].includes("could not be added to Jane Doe's calendar"))
  assert(pushes[1].includes("could not be deleted from Jane Doe's calendar"))
  for (const push of pushes) assertFalse(push.includes(TEST_CALDAV.password))
})
