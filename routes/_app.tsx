import { define } from "../lib/utils.ts";
import { themeBootstrapScript } from "../lib/theme.ts";

// Default root layout. Wraps every page in <html>+<body> with theme
// bootstrap, Tailwind, and the mig favicon.

export default define.page(function App({ Component, state }) {
  return (
    <html lang="en" class="h-full">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#f97316" />
        <title>{`Book a meeting with ${state.config.hostName}`}</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        {/* Critical inline CSS to prevent FOUC while Tailwind loads */}
        <style
          dangerouslySetInnerHTML={{
            __html:
              `:root{color-scheme:dark light}html,body{background:#0f172a;color:#e2e8f0;margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}`,
          }}
        />
        <link rel="stylesheet" href="/styles.css" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript() }} />
      </head>
      <body class="h-full bg-slate-900 text-slate-200">
        <a
          href="#main"
          class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-orange-500 focus:text-white focus:rounded-md"
        >
          Skip to content
        </a>
        <Component />
      </body>
    </html>
  );
});
