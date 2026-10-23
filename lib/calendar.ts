// The owner's CalDAV calendar (mig#139). A booking is written there as an
// event and a cancellation removes it, so a booking reaches the owner's
// calendar without the owner opening the mailed .ics by hand.
//
// Optional: with no CALDAV_* settings nothing here sends a request. Fail-
// soft: a calendar failure is logged and pushed through ntfy, and never
// stops a booking or a cancellation. mig has no background jobs, so a
// failure is not retried.
//
// The client is @spy4x/caldav's. It attaches the password only to the
// calendar's own origin and refuses plain http unless `allowHttp` is set,
// which mig sets only for a loopback host (lib/config.ts refuses any
// other http address at startup).

import {
  type CalDavClient,
  type CalDavError,
  CalDavErrorCode,
  createCalDavClient,
} from "@spy4x/caldav"
import { childUrl } from "@spy4x/caldav/url"
import { isLoopbackHost } from "@spy4x/net/ip"
import { generateIcs } from "@spy4x/time/ics"
import { bookingInvite } from "./invite.ts"
import { notifyCalendarFailed } from "./notify.ts"
import { err, ok, type Result } from "./types.ts"
import type { Booking, Config } from "./types.ts"

/** What a calendar call did. */
export enum CalendarOutcome {
  /** No CALDAV_* settings: nothing was sent. */
  Off = 1,
  /** The event is in the calendar, or is gone from it, as asked. */
  Done,
  /** The call failed; it was logged and pushed. */
  Failed,
}

/** One whole calendar call, redirects included. The booking and cancel
 *  handlers wait for it before they answer, like the ntfy push. */
export const CALENDAR_TIMEOUT_MS = 5_000

let fetchForTesting: typeof fetch | null = null

/** Test-only seam: the `fetch` every calendar call uses until called
 *  again with `null`. Never call this outside a test. */
export function setCalendarFetchForTesting(f: typeof fetch | null): void {
  fetchForTesting = f
}

/** Whether `raw` may be CALDAV_CALENDAR_URL: an `https:` URL, or `http:`
 *  on a loopback host, with no username or password in it (the password
 *  has its own setting and would otherwise reach logs with the URL). */
export function isAllowedCalendarUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.username !== "" || url.password !== "") return false
  if (url.protocol === "https:") return true
  return url.protocol === "http:" && isLoopbackHost(url.hostname)
}

type CalendarSettings = NonNullable<Config["caldav"]>

function clientFor(settings: CalendarSettings): CalDavClient {
  const url = new URL(settings.calendarUrl)
  return createCalDavClient({
    serverUrl: url,
    allowHttp: url.protocol === "http:" && isLoopbackHost(url.hostname),
    auth: { username: settings.username, password: settings.password },
    timeoutMs: CALENDAR_TIMEOUT_MS,
    ...(fetchForTesting ? { fetch: fetchForTesting } : {}),
  })
}

/** The booking's resource name in the calendar. Fixed per booking, so a
 *  repeated write finds the first one instead of adding a second event. */
function objectName(booking: Booking): string {
  return `${booking.id}.ics`
}

/** The event written to the owner's calendar: the owner's invite from
 *  lib/invite.ts, titled with the guest's name, and with no ORGANIZER or
 *  ATTENDEE. With those, a server that does CalDAV scheduling (Stalwart
 *  does) mails the guest an invitation of its own from the owner's
 *  mailbox when the event is written, and a cancellation when it is
 *  deleted; mig mails the guest itself. The guest's name and address go
 *  in the description instead. */
export function calendarIcs(
  booking: Booking,
  config: Config,
  cancelUrl: string,
  now = new Date(),
): string {
  const { event, options } = bookingInvite(
    booking,
    config,
    cancelUrl,
    booking.hostTz,
    booking.guestTz,
    now,
    "owner",
  )
  return generateIcs({
    ...event,
    summary: `Meeting with ${booking.guestName}`,
    description: `Guest: ${booking.guestName} <${booking.guestEmail}>\n` +
      event.description,
    organizer: undefined,
    attendees: undefined,
  }, options)
}

/** A failed call as a log line: the code's name and the client's message.
 *  Neither carries the password: the client never puts credentials in a
 *  message, and the calendar URL holds none (lib/config.ts). */
function describe(error: CalDavError): string {
  const status = error.status === undefined ? "" : ` (HTTP ${error.status})`
  return `${CalDavErrorCode[error.code]}${status}: ${error.message}`
}

/** Runs `work`, turning a throw (a bad event, a refused client option)
 *  into a failed result, so no calendar problem escapes as an exception. */
async function attempt(
  work: () => Promise<Result<void, string>>,
): Promise<Result<void, string>> {
  try {
    return await work()
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e))
  }
}

/** Write the booking's event to the owner's calendar. An object already
 *  at the booking's name counts as written. */
export async function addBookingToCalendar(
  config: Config,
  booking: Booking,
  cancelUrl: string,
): Promise<CalendarOutcome> {
  const settings = config.caldav
  if (!settings) return CalendarOutcome.Off
  const result = await attempt(async () => {
    const ics = calendarIcs(booking, config, cancelUrl)
    const written = await clientFor(settings).createObject(
      settings.calendarUrl,
      ics,
      { name: objectName(booking) },
    )
    if (written.success) return ok(undefined)
    if (written.error.code === CalDavErrorCode.AlreadyExists) {
      return ok(undefined)
    }
    return err(describe(written.error))
  })
  if (result.ok) return CalendarOutcome.Done
  console.error(
    `mig: calendar write FAILED; booking=${booking.id}: ${result.error}`,
  )
  await notifyCalendarFailed(config, booking, "add", result.error)
  return CalendarOutcome.Failed
}

/** Delete the booking's event from the owner's calendar. An event that is
 *  already gone counts as deleted. */
export async function removeBookingFromCalendar(
  config: Config,
  booking: Booking,
): Promise<CalendarOutcome> {
  const settings = config.caldav
  if (!settings) return CalendarOutcome.Off
  const result = await attempt(async () => {
    const client = clientFor(settings)
    const found = await client.getObject(
      childUrl(settings.calendarUrl, objectName(booking)),
    )
    if (!found.success) {
      return found.error.code === CalDavErrorCode.NotFound
        ? ok(undefined)
        : err(describe(found.error))
    }
    if (found.output.etag === null) {
      return err("the server sent no usable ETag, so the event was not deleted")
    }
    const deleted = await client.deleteObject(
      found.output.url,
      found.output.etag,
    )
    if (deleted.success) return ok(undefined)
    if (deleted.error.code === CalDavErrorCode.NotFound) return ok(undefined)
    return err(describe(deleted.error))
  })
  if (result.ok) return CalendarOutcome.Done
  console.error(
    `mig: calendar delete FAILED; booking=${booking.id}: ${result.error}`,
  )
  await notifyCalendarFailed(config, booking, "remove", result.error)
  return CalendarOutcome.Failed
}
