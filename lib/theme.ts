// Theme bootstrap helper. Renders a tiny inline script in <head> so the
// page paints in the right theme before Tailwind/CSS arrives, with no
// flash of wrong-coloured content.
//
// `mode` is the user's stored preference (`light`, `dark`, or `auto`).
// With nothing stored, it is the owner's `THEME` setting (mig#52),
// passed in as `defaultMode`; `auto` there keeps following the system.
// We expose `__migTheme()` on `window` so the ThemeToggle island can
// mutate the stored mode + update the DOM without round-tripping the
// server. `data-theme` is also set on <html> for any consumer that wants
// to react to it via CSS attribute selectors.

export type ThemeParam = "light" | "dark" | "auto";

/** Parses `/embed`'s `?theme=` query param (mig#44). Anything other
 *  than exactly `"light"` or `"dark"` — missing, empty, or any other
 *  string — resolves to `"auto"`, today's default behaviour (stored
 *  preference, then `prefers-color-scheme`; see `themeBootstrapScript`
 *  below). The raw value is never reflected back into the page
 *  unescaped: only this parsed, three-way result is ever used. */
export function parseThemeParam(raw: string | null): ThemeParam {
  return raw === "light" || raw === "dark" ? raw : "auto";
}

/** The inline `<head>` script that applies the theme before first
 *  paint and exposes `window.__migTheme` for the ThemeToggle island.
 *  A visitor's stored `mig-theme` value (`light`, `dark` or `auto`)
 *  always wins; with nothing stored, `defaultMode` (the owner's
 *  `THEME`, mig#52) decides, and `auto` follows `prefers-color-scheme`.
 *  `defaultMode` goes through `parseThemeParam` before it is written
 *  into the script, so only one of the three literals can reach it. */
export function themeBootstrapScript(defaultMode: ThemeParam = "auto"): string {
  const d = parseThemeParam(defaultMode);
  return `(function(){try{
var K="mig-theme";
var s=localStorage.getItem(K);
var m=(s==="light"||s==="dark"||s==="auto")?s:"${d}";
var prefersDark=matchMedia("(prefers-color-scheme: dark)").matches;
var dark=m==="dark"||(m==="auto"&&prefersDark);
document.documentElement.classList.toggle("dark",dark);
document.documentElement.dataset.theme=dark?"dark":"light";
window.__migTheme={mode:function(){return m},apply:function(next){
if(next!=="light"&&next!=="dark"&&next!=="auto")return m;
m=next;
try{localStorage.setItem(K,next)}catch(_e){}
var d2=next==="dark"||(next==="auto"&&matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.toggle("dark",d2);
document.documentElement.dataset.theme=d2?"dark":"light";
return next;
}};
if(matchMedia){
var mq=matchMedia("(prefers-color-scheme: dark)");
mq.addEventListener("change",function(){
if(m!=="auto")return;
var d3=mq.matches;
document.documentElement.classList.toggle("dark",d3);
document.documentElement.dataset.theme=d3?"dark":"light";
});
}
}catch(_e){}})();`;
}

// mig#44 — /embed's forced theme (`?theme=dark|light`) is read straight
// from the URL, not threaded in via route state: routes/_app.tsx has to
// resolve it before the shared layout renders <html>, and every route
// already has `url` in its PageProps for free. `auto` (the default,
// including no param at all, or any other route) keeps today's
// behaviour untouched: no server-rendered class, no data-theme, and
// the same client bootstrap script runs. Scoped to `/embed*` — the
// standalone site has no such query param and must not start
// honouring one it never advertised.
//
// mig#52 — without an explicit `?theme=light|dark`, /embed follows the
// owner's `THEME` setting the same way: forced server-side when it is
// `light` or `dark`, today's client bootstrap when it is `auto`. An
// iframe has no theme toggle, so a visitor's stored preference never
// overrides `THEME` there; on the standalone site it still does (see
// themeBootstrapScript above).
//
// mig#63 — the not-found and error pages use it too: when it returns a
// theme, _app.tsx leaves out the bootstrap script, so their theme button
// would do nothing and they hide it.
export function forcedThemeFor(
  url: URL,
  configured: ThemeParam,
): "light" | "dark" | null {
  if (!url.pathname.startsWith("/embed")) return null;
  const parsed = parseThemeParam(url.searchParams.get("theme"));
  if (parsed !== "auto") return parsed;
  return configured === "auto" ? null : configured;
}
