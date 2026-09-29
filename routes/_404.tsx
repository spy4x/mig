import { buttonClasses } from "@spy4x/preact-ui/button";
import { EmptyState } from "@spy4x/preact-ui/empty-state";
import { define } from "../lib/utils.ts";
import { Header } from "../components/Header.tsx";
import { Footer } from "../components/Footer.tsx";
import { forcedThemeFor } from "../lib/theme.ts";

// Fresh renders the not-found page with status 200 unless its handler
// sets another one, so a missing page answered 200 (mig#68). One handler
// for every method: a POST to a missing path is just as not found.
export const handler = define.handlers(() => ({
  data: undefined,
  status: 404,
}));

export default define.page(function NotFound({ state, url }) {
  const cfg = state.config;
  return (
    <div class="min-h-dvh flex flex-col">
      <Header
        compact
        defaultTheme={cfg.theme}
        themeToggle={forcedThemeFor(url, cfg.theme) === null}
      />
      <main class="flex-1 grid place-items-center px-6 py-16">
        <div class="w-full max-w-[650px]">
          <p class="mb-3 text-center text-xs font-medium uppercase tracking-[0.18em] text-brand-600 dark:text-brand-300">
            404
          </p>
          <h1 class="mb-3 text-center text-xl font-semibold tracking-(--tracking-tight) text-ink">
            Page not found
          </h1>
          <EmptyState
            description="The page you're looking for doesn't exist."
            action={
              <a href="/" class={buttonClasses()}>
                Back to booking
              </a>
            }
          />
        </div>
      </main>
      <Footer
        githubUrl={cfg.githubUrl}
        hidden={cfg.hideBranding}
        version={cfg.version}
      />
    </div>
  );
});
