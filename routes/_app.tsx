import { SEOHead } from "@spy4x/preact-system/seo-head"
import { buttonClasses } from "@spy4x/preact-ui/button"
import { define } from "../lib/utils.ts"
import {
  forcedThemeFor,
  pageHasNoThemeToggle,
  themeScript,
} from "../lib/theme.ts"

// Default root layout. Wraps every page in <html>+<body> with theme
// bootstrap, meta tags, and the mig favicon.
//
// Meta discipline:
//   - title: per-page (set inside each route's <title>)
//   - description: stable across pages, used by embeds + SEO
//   - OG / Twitter: same stable description for unfurled links
//   - theme-color: light + dark variants for browser chrome
//
// The inline <style> paints the canvas while the stylesheet loads. The
// full styles arrive via the Vite-bundled stylesheet.

/** The library's light canvas (gray-100). */
const CANVAS_LIGHT = "#f3f4f6"
/** The library's ink canvas, `oklch(0.15 0.012 260)`. */
const CANVAS_DARK = "#080b10"

export default define.page(function App({ Component, state, url }) {
  const cfg = state.config
  const title = `Book a meeting with ${cfg.hostName} · mig`
  const description =
    `${cfg.hostName} — ${cfg.slotDurationMin}-minute video call. Pick a time that works for you.`
  const canonical = new URL(url.pathname, cfg.publicUrl).toString()
  const forcedTheme = forcedThemeFor(url, cfg.theme)

  return (
    <html
      lang="en"
      class={`h-full antialiased${forcedTheme === "dark" ? " dark" : ""}`}
      // The library's ink dark palette applies to `.dark[data-theme="ink"]`,
      // so every page carries `data-theme="ink"` and the theme script only
      // toggles `.dark`. /embed's forced theme (mig#44) sits on its own
      // attribute.
      data-theme="ink"
      data-forced-theme={forcedTheme ?? undefined}
      // mig#44 review: the meta color-scheme tag below stays "light
      // dark" (the page's default supported schemes); this inline
      // style is what actually pins native UI — scrollbars, form
      // control and autofill chrome — to the one scheme this document
      // renders in once a theme is forced, the same way `class="dark"`
      // pins the palette.
      style={forcedTheme ? `color-scheme: ${forcedTheme}` : undefined}
    >
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="color-scheme" content="light dark" />
        {/* Each equals the canvas of its palette: the library's gray-100 and ink. */}
        <meta
          name="theme-color"
          content={CANVAS_LIGHT}
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content={CANVAS_DARK}
          media="(prefers-color-scheme: dark)"
        />
        <SEOHead
          title={title}
          description={description}
          canonical={canonical}
        />
        <link
          rel="icon"
          type="image/svg+xml"
          href="/favicon.svg"
        />

        {
          /* The canvas before the stylesheet arrives, so neither palette
             flashes the other's background. Only the page background:
             every token stays the library's. */
        }
        <style
          dangerouslySetInnerHTML={{
            __html:
              `html{background:${CANVAS_LIGHT}}html.dark{background:${CANVAS_DARK}}body{margin:0}`,
          }}
        />
        {
          /* Tailwind CSS is bundled by Vite via the import in client.ts
             and injected by Fresh's runtime at <link rel="stylesheet"
             href="/assets/styles-…css">. No manual link needed. */
        }
        {
          /* mig#44 — skipped when the theme is already forced: the
             <html> attributes above already applied it server-side,
             with no flash, and this script would otherwise read
             localStorage/prefers-color-scheme and overwrite it on the
             very first paint. */
        }
        {forcedTheme === null && (
          <script
            dangerouslySetInnerHTML={{
              __html: themeScript(cfg.theme, {
                followSystem: pageHasNoThemeToggle(url),
              }),
            }}
          />
        )}
      </head>
      <body class="theme-base h-full min-h-dvh">
        <a
          href="#main"
          class={buttonClasses(
            "outline",
            "md",
            "sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 shadow-popover",
          )}
        >
          Skip to content
        </a>
        <Component />
      </body>
    </html>
  )
})
