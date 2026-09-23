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
 *  one). Omit it (or pass null/undefined) before the zone is known. */
export function pickerHref(
  basePath: string,
  params?: Record<string, string>,
  tz?: string | null,
): string {
  const path = pickerPath(basePath);
  const merged: Record<string, string> = { ...params };
  if (tz) merged.tz = tz;
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
 *  is unit-testable without driving a real `history.pushState`. It
 *  does not, by itself, prove `pushUrl` actually calls it with the
 *  right `tz`: see `pickerLinks` below for the part that closes that
 *  gap, and its doc comment for the one gap neither of them closes. */
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
 *  behaviour (mig#18 review follow-up): the `<a href>`s the picker's
 *  children render (via `tz`) and the address `pushUrl` pushes (via
 *  `pushAddress`). `BookingFlow.tsx` computes `linkTz` once per
 *  render and used to thread it through by hand — `tz={linkTz}` on
 *  four separate children, and a separate `pickerPushAddress(next,
 *  linkTz)` call inside `pushUrl` — which left a call site for a
 *  regression to hide in: swapping either call's `linkTz` for `null`
 *  changed nothing else in the file, so nothing about the *shape* of
 *  the code caught it, only a test exercising that exact call would.
 *  `pickerLinks(linkTz)` replaces both call sites with one shared
 *  value: `links.tz` for every child, `links.pushAddress(next)`
 *  inside `pushUrl`. A mutation now has nowhere smaller to live than
 *  the `pickerLinks(linkTz)` call itself, and its nearest form —
 *  `pickerLinks(null)` — empties every link `tz`, including the ones
 *  a server-rendered test already checks (`routes/index.test.tsx`).
 *
 *  What this still doesn't cover: `pushUrl` could be rewritten to
 *  build its own `URLSearchParams` from scratch, bypassing
 *  `pushAddress` (and therefore `pickerPushAddress`) entirely. That
 *  form of the mutation is invisible to every test in this suite —
 *  `pickerLinks`'s own tests call `pushAddress` directly, and a
 *  server render never calls `pushUrl` at all, since the handlers
 *  that call it are wired up client-side after hydration. Catching
 *  it needs a real browser driving a click and reading
 *  `location.search` afterward; this repo has no such test
 *  infrastructure today. */
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
