// URL builder for the picker's links (the no-JS fallback) and for the
// addresses BookingFlow pushes into history once hydrated.
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
 *  browser's history. Same params `pickerHref` builds `<a href>`s from,
 *  under the same `basePath` ("" standalone, "/embed" in the iframe —
 *  mig#85), with `tz` (mig#18) and `theme` (mig#44) carried the same
 *  way, so a reload or a copied URL keeps showing the visitor's own
 *  clocks, stays under /embed, and keeps the forced theme.
 *
 *  Pulled out of `pushUrl` as a pure function so this piece of the
 *  behaviour is unit-testable without driving a real
 *  `history.pushState`. No test runs `pushUrl` itself (a server render
 *  never calls it), so an edit inside `pushUrl` that builds its own
 *  address instead of calling `links.pushAddress` stays green. */
export function pickerPushAddress(
  next: { date: string | null; slot?: string | null; month?: string },
  tz: string | null,
  basePath = "",
  theme: string | null = null,
): string {
  const params: Record<string, string> = {};
  if (next.date) params.date = next.date;
  if (next.slot) params.slot = next.slot;
  if (next.month) params.month = next.month;
  return pickerHref(basePath, params, tz, theme);
}

/** Binds one `tz`, `basePath` and `theme` for both halves of the
 *  picker's link behaviour: the `<a href>`s the picker's children
 *  render and the address `pushUrl` pushes (via `pushAddress`).
 *  `BookingFlow.tsx` computes these once per render and passes them
 *  here, then threads `links.*` into every child — one shared value
 *  instead of five separate call sites that could drift. */
export function pickerLinks(
  tz: string | null,
  basePath = "",
  theme: string | null = null,
): {
  tz: string | null;
  basePath: string;
  theme: string | null;
  pushAddress(
    next: { date: string | null; slot?: string | null; month?: string },
  ): string;
} {
  return {
    tz,
    basePath,
    theme,
    pushAddress: (next) => pickerPushAddress(next, tz, basePath, theme),
  };
}
