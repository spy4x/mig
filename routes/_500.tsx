import { buttonClasses } from "@spy4x/preact-ui/button";
import { EmptyState } from "@spy4x/preact-ui/empty-state";
import { define } from "../lib/utils.ts";
import { Header } from "../components/Header.tsx";
import { Footer } from "../components/Footer.tsx";
import { forcedThemeFor } from "../lib/theme.ts";

export default define.page(function Error(
  // deno-lint-ignore no-explicit-any
  { error, state, url }: { error?: any; state?: any; url?: URL },
) {
  const cfg = state?.config;
  const message = error?.message ?? "Unexpected error.";
  return (
    <div class="min-h-dvh flex flex-col">
      {cfg && (
        <Header
          compact
          defaultTheme={cfg.theme}
          themeToggle={!url || forcedThemeFor(url, cfg.theme) === null}
        />
      )}
      <main class="flex-1 grid place-items-center px-6 py-16">
        <div class="w-full max-w-[650px]">
          <p class="mb-3 text-center text-xs font-medium uppercase tracking-[0.18em] text-red-600 dark:text-red-400">
            500
          </p>
          <h1 class="mb-3 text-center text-xl font-semibold tracking-(--tracking-tight) text-ink">
            Something went wrong
          </h1>
          <EmptyState
            description={message}
            action={
              <a href="/" class={buttonClasses()}>
                Back to booking
              </a>
            }
          />
        </div>
      </main>
      {cfg && (
        <Footer
          githubUrl={cfg.githubUrl}
          hidden={cfg.hideBranding}
          version={cfg.version}
        />
      )}
    </div>
  );
});
