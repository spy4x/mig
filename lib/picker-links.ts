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
 *  (or pass an empty object) for a bare link back to the picker root. */
export function pickerHref(
  basePath: string,
  params?: Record<string, string>,
): string {
  const path = pickerPath(basePath);
  if (!params || Object.keys(params).length === 0) return path;
  return `${path}?${new URLSearchParams(params).toString()}`;
}
