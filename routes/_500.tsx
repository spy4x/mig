import { Button } from "@spy4x/preact-ui/button"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { define } from "../lib/utils.ts"
import { Header } from "../components/Header.tsx"
import { Footer } from "../components/Footer.tsx"
import { forcedThemeFor } from "../lib/theme.ts"

export default define.page(function Error(
  // deno-lint-ignore no-explicit-any
  { error, state, url }: { error?: any; state?: any; url?: URL },
) {
  const cfg = state?.config
  const message = error?.message ?? "Unexpected error."
  return (
    <div class="min-h-dvh flex flex-col">
      {cfg && (
        <Header
          defaultTheme={cfg.theme}
          themeToggle={!url || forcedThemeFor(url, cfg.theme) === null}
        />
      )}
      <main
        id="main"
        tabIndex={-1}
        class="flex-1 px-4 py-12 outline-hidden sm:px-6"
      >
        <div class="mx-auto w-full max-w-md text-center">
          <p class="mb-2 text-sm font-medium text-muted tabular-nums">500</p>
          <h1 class="mb-4 text-2xl font-semibold tracking-tight text-foreground">
            Something went wrong
          </h1>
          <EmptyState
            description={message}
            action={
              <Button href="/" class="min-h-11 sm:min-h-9">Book a time</Button>
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
  )
})
