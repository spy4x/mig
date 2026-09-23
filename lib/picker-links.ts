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
