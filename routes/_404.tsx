import { define } from "../lib/utils.ts";
import { Header } from "../components/Header.tsx";
import { Footer } from "../components/Footer.tsx";

export default define.page(function NotFound({ state }) {
  const cfg = state.config;
  return (
    <div class="min-h-dvh flex flex-col">
      <Header compact />
      <main class="flex-1 grid place-items-center px-6 py-16">
        <div class="max-w-sm text-center">
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-brand-600 dark:text-brand-300 mb-3">
            404
          </p>
          <h1 class="text-xl font-semibold tracking-(--tracking-tight) text-ink mb-2">
            Page not found
          </h1>
          <p class="text-sm text-ink-muted mb-6">
            The page you're looking for doesn't exist.
          </p>
          <a
            href="/"
            class="inline-flex items-center justify-center rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Back to booking
          </a>
        </div>
      </main>
      <Footer githubUrl={cfg.githubUrl} hidden={cfg.hideBranding} />
    </div>
  );
});
