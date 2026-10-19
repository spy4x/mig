import { Button } from "@spy4x/preact-ui/button"
import { EmptyState } from "@spy4x/preact-ui/empty-state"
import { define } from "../lib/utils.ts"
import { Header } from "../components/Header.tsx"
import { Footer } from "../components/Footer.tsx"
import { forcedThemeFor } from "../lib/theme.ts"

// Fresh renders the not-found page with status 200 unless its handler
// sets another one, so a missing page answered 200 (mig#68). One handler
// for every method: a POST to a missing path is just as not found.
export const handler = define.handlers(() => ({
  data: undefined,
  status: 404,
}))

export default define.page(function NotFound({ state, url }) {
  const cfg = state.config
  return (
    <div class="min-h-dvh flex flex-col">
      <Header
        defaultTheme={cfg.theme}
        themeToggle={forcedThemeFor(url, cfg.theme) === null}
      />
      <main class="flex-1 px-4 py-12 sm:px-6">
        <div class="mx-auto w-full max-w-md text-center">
          <p class="mb-2 text-sm font-medium text-muted tabular-nums">404</p>
          <h1 class="mb-4 text-2xl font-semibold tracking-tight text-foreground">
            Page not found
          </h1>
          <EmptyState
            description="The page you're looking for doesn't exist."
            action={
              <Button href="/" class="min-h-11 sm:min-h-9">Book a time</Button>
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
  )
})
