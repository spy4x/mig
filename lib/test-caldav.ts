// Test-only: a fake CalDAV server behind `setCalendarFetchForTesting`
// (lib/calendar.ts), so a test sees every request mig sends to the
// owner's calendar and picks each answer. Nothing here touches the
// network.

import { setCalendarFetchForTesting } from "./calendar.ts"
import type { Config } from "./types.ts"

/** One request the fake received. */
export interface CalDavRequest {
  method: string
  url: string
  headers: Headers
  body: string
}

/** Settings for a test config's `caldav`. Not a real password. */
export const TEST_CALDAV: NonNullable<Config["caldav"]> = {
  calendarUrl: "https://dav.example.com/dav/cal/jane/meetings/",
  username: "jane@example.com",
  password: "CALDAV-PASSWORD-MARKER-not-real",
}

/** Installs a fake `fetch` that records each request and answers with
 *  `answer(request)`, until the returned value is disposed. */
export function fakeCalDav(
  answer: (request: CalDavRequest) => Response = () =>
    new Response(null, { status: 201 }),
): { requests: CalDavRequest[] } & Disposable {
  const requests: CalDavRequest[] = []
  setCalendarFetchForTesting((input, init) => {
    const request = {
      method: init?.method ?? "GET",
      url: String(input),
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : "",
    }
    requests.push(request)
    return Promise.resolve(answer(request))
  })
  return {
    requests,
    [Symbol.dispose]: () => setCalendarFetchForTesting(null),
  }
}
