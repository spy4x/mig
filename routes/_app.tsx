import { define } from "../lib/utils.ts";
import { themeBootstrapScript } from "../lib/theme.ts";

// Default root layout. Wraps every page in <html>+<body> with theme
// bootstrap, meta tags, and the mig favicon.
//
// Meta discipline:
//   - title: per-page (set inside each route's <title>)
//   - description: stable across pages, used by embeds + SEO
//   - OG / Twitter: same stable description for unfurled links
//   - theme-color: light + dark variants for browser chrome
//
// Inline critical CSS prevents the FOUC while Tailwind loads. We
// intentionally keep this short — full styles arrive via the
// Vite-bundled stylesheet.

export default define.page(function App({ Component, state, url }) {
  const cfg = state.config;
  const title = `Book a meeting with ${cfg.hostName} · mig`;
  const description =
    `${cfg.hostName} — ${cfg.slotDurationMin}-minute video call. Pick a time that works for you.`;
  const canonical = new URL(url.pathname, cfg.publicUrl).toString();

  return (
    <html lang="en" class="h-full antialiased">
      <head>
        <meta charset="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="color-scheme" content="light dark" />
        <meta
          name="theme-color"
          content="#ffffff"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#0a0a0b"
          media="(prefers-color-scheme: dark)"
        />
        <meta name="description" content={description} />

        {/* Open Graph / Twitter */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonical} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />

        <title>{title}</title>
        <link rel="canonical" href={canonical} />
        <link
          rel="icon"
          type="image/svg+xml"
          href="/favicon.svg"
        />

        {
          /* Critical inline CSS to prevent FOUC while Tailwind loads.
           Variables here mirror the @theme tokens; the real values
           are baked in by Tailwind once it loads. */
        }
        <style
          dangerouslySetInnerHTML={{
            __html: `:root{
  --color-surface:oklch(0.99 0.003 80);
  --color-ink:oklch(0.18 0.01 60);
}
.dark{
  --color-surface:oklch(0.16 0.012 260);
  --color-ink:oklch(0.96 0.005 80);
}
html,body{margin:0;background:var(--color-surface);color:var(--color-ink);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}`,
          }}
        />
        {
          /* Tailwind CSS is bundled by Vite via the import in client.ts
             and injected by Fresh's runtime at <link rel="stylesheet"
             href="/assets/styles-…css">. No manual link needed. */
        }
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript() }} />
      </head>
      <body class="h-full min-h-dvh">
        <a
          href="#main"
          class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-3.5 focus:py-2 focus:bg-brand-500 focus:text-white focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-300"
        >
          Skip to content
        </a>
        <Component />
      </body>
    </html>
  );
});
