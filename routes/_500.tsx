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
        <EmptyState
          title="Something went wrong"
          description={message}
          action={
            <a href="/" class={buttonClasses()}>
              Back to booking
            </a>
          }
        />
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
