// URL builder for the no-JS / /embed picker fallback links.
//
// `basePath` is always a compile-time constant chosen by the route
// that renders the picker ("" for the standalone page at "/", or
// "/embed" for the iframe variant) — never derived from a request or
// form field. That's what keeps /embed self-contained: every link the
// picker renders stays under the base path it was given.

/** The path a "no params" link should point at: "/" for the
 *  standalone page, the base path itself (e.g. "/embed") otherwise. */
export function pickerPath(basePath: string): string {
  return basePath === "" ? "/" : basePath;
}

/** Build an `href` for a picker link, e.g. `pickerHref("/embed", {
 *  date: "2026-09-21" })` → `"/embed?date=2026-09-21"`. Omit `params`
 *  (or pass an empty object) for a bare link back to the picker root.
 *
 *  `tz` (mig#15) is the visitor's IANA zone, once known — pass it and
 *  every link the picker renders carries it forward, so /embed stays
 *  in the visitor's timezone across the whole flow without a cookie
 *  (see lib/guest-tz-script.ts for why a query param was chosen over
 *  one). Omit it (or pass null/undefined) before the zone is known.
 *
 *  `theme` (mig#44) is /embed's forced theme, once known — the
 *  caller has already resolved `?theme=auto` (the default) to
 *  `null`, so this only ever writes `"light"` or `"dark"` onto the
 *  link, keeping a today's-URL, `auto` request unchanged. Threaded
 *  the same way as `tz`, so the forced theme survives every step of
 *  the embed flow. */
export function pickerHref(
  basePath: string,
  params?: Record<string, string>,
  tz?: string | null,
  theme?: string | null,
): string {
  const path = pickerPath(basePath);
  const merged: Record<string, string> = { ...params };
  if (tz) merged.tz = tz;
  if (theme) merged.theme = theme;
  if (Object.keys(merged).length === 0) return path;
  return `${path}?${new URLSearchParams(merged).toString()}`;
}

/** Build the address `BookingFlow.tsx`'s `pushUrl` writes into the
 *  browser's history for the standalone picker (basePath "" — the
 *  island only ever runs there, never under /embed). Same params
 *  `pickerHref` builds `<a href>`s from, and `tz` carried the same
 *  way (mig#18), so a reload or a copied URL keeps showing the
 *  visitor's own clocks instead of falling back to the host's.
 *
 *  Pulled out of `pushUrl` as a pure function so *this* piece of the
 *  behaviour — given a `tz`, does the address it builds carry it —
 *  is unit-testable without driving a real `history.pushState`.
 *
 *  No test runs `pushUrl` itself: a server render never calls it (its
 *  handlers only exist after client-side hydration), and
 *  `picker-links.test.ts` calls `pushAddress`/`pickerPushAddress`
 *  directly, not through `pushUrl`. So an edit inside `pushUrl` that
 *  drops `tz` —
 *  whether it builds its own `URLSearchParams` by hand, calls
 *  `pickerLinks(null).pushAddress(next)`, or calls
 *  `pickerPushAddress(next, null)` directly — stays green. The one
 *  thing a test *does* catch is an edit to the `pickerLinks(linkTz)`
 *  binding in `BookingFlow.tsx` (see `pickerLinks` below), because
 *  that same binding also feeds the `tz` on every `<a href>` the
 *  server-rendered test in `routes/index.test.tsx` checks. */
export function pickerPushAddress(
  next: { date: string | null; slot?: string | null; month?: string },
  tz: string | null,
): string {
  const params: Record<string, string> = {};
  if (next.date) params.date = next.date;
  if (next.slot) params.slot = next.slot;
  if (next.month) params.month = next.month;
  return pickerHref("", params, tz);
}

/** Binds one `tz` for both halves of the picker's tz-carrying
 *  behaviour: the `<a href>`s the picker's children render (via
 *  `tz`) and the address `pushUrl` pushes (via `pushAddress`).
 *  `BookingFlow.tsx` computes `linkTz` once per render and passes it
 *  here, then uses `links.tz` for every child and
 *  `links.pushAddress(next)` inside `pushUrl` — one shared value
 *  instead of threading `linkTz` to five separate call sites by hand.
 *
 *  What a test can and can't see through this binding:
 *  `pickerPushAddress`/`pushAddress` are unit-tested
 *  (`lib/picker-links.test.ts`), and `routes/index.test.tsx` server-
 *  render-tests the slot-list `<a href>`s only — the date card,
 *  calendar and time card links are not covered. `pushUrl` itself is
 *  not tested at all — see `pickerPushAddress`'s doc comment above
 *  for exactly what that leaves uncaught. */
export function pickerLinks(tz: string | null): {
  tz: string | null;
  pushAddress(
    next: { date: string | null; slot?: string | null; month?: string },
  ): string;
} {
  return {
    tz,
    pushAddress: (next) => pickerPushAddress(next, tz),
  };
}
