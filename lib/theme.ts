// Theme on first paint. `themeScript()` renders the inline <head> script
// that paints the stored theme before CSS arrives, with no flash of the
// wrong palette. The painting itself is @spy4x/preact-signals'
// `themeBootstrapScript`; the ThemeToggle island attaches the matching
// `createThemeStore` with the same key and default, which then follows
// system changes and stores the visitor's choice. `/embed` has no
// islands, so there the script itself keeps following the system
// (`followSystem`).
//
// mig's own vocabulary is `light`, `dark` or `auto` (THEME, `?theme=`);
// the shared store says `system` for `auto`.

import {
  themeBootstrapScript,
  type ThemePreference,
  ThemeValue,
} from "@spy4x/preact-signals/theme";

export type ThemeParam = "light" | "dark" | "auto";

/** Where a visitor's choice is kept, as before the shared store. */
export const THEME_STORAGE_KEY = "mig-theme";

/** Parses `/embed`'s `?theme=` query param (mig#44). Anything other
 *  than exactly `"light"` or `"dark"` — missing, empty, or any other
 *  string — resolves to `"auto"`, today's default behaviour (stored
 *  preference, then `prefers-color-scheme`; see `themeScript`
 *  below). The raw value is never reflected back into the page
 *  unescaped: only this parsed, three-way result is ever used. */
export function parseThemeParam(raw: string | null): ThemeParam {
  return raw === "light" || raw === "dark" ? raw : "auto";
}

/** mig's `THEME` value as the shared store's preference; anything
 *  unknown is `auto`, so `system`. */
export function themePreference(mode: ThemeParam): ThemePreference {
  const parsed = parseThemeParam(mode);
  if (parsed === "light") return ThemeValue.LIGHT;
  if (parsed === "dark") return ThemeValue.DARK;
  return ThemeValue.SYSTEM;
}

// Before the shared store, "follow the system" was stored as `auto`.
// The shared script does not know that value and would paint the
// owner's THEME instead, so a stored `auto` is rewritten to `system`
// first, and that visitor keeps following their system.
const MIGRATE_STORED_AUTO =
  `(function(){try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="auto")` +
  `localStorage.setItem("${THEME_STORAGE_KEY}","system")}catch(e){}})();`;

/** The inline `<head>` script: migrate a stored `auto`, then paint the
 *  stored theme, or the owner's `THEME` (mig#52) when nothing is
 *  stored. `defaultMode` goes through `themePreference`, so only one
 *  of three literals can reach the script.
 *
 *  `followSystem` is for a page without the ThemeToggle island: the
 *  script then also repaints on an OS theme change while the stored
 *  preference is `system`. A page with the island leaves it off, since
 *  the island's store already does that and also knows a choice the
 *  browser refused to store. */
export function themeScript(
  defaultMode: ThemeParam = "auto",
  { followSystem = false }: { followSystem?: boolean } = {},
): string {
  return MIGRATE_STORED_AUTO + themeBootstrapScript({
    storageKey: THEME_STORAGE_KEY,
    defaultPreference: themePreference(defaultMode),
    followSystem,
  });
}

/** Whether the page at `url` renders without the ThemeToggle island:
 *  every `/embed` page. */
export function pageHasNoThemeToggle(url: URL): boolean {
  return url.pathname === "/embed" || url.pathname.startsWith("/embed/");
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
// themeScript above).
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
