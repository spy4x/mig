import { define } from "../lib/utils.ts";
import { Header } from "../components/Header.tsx";
import { Footer } from "../components/Footer.tsx";

export default define.page(function Error(
  // deno-lint-ignore no-explicit-any
  { error, state }: { error?: any; state?: any },
) {
  const cfg = state?.config;
  const message = error?.message ?? "Unexpected error.";
  return (
    <div class="min-h-dvh flex flex-col">
      {cfg && <Header compact />}
      <main class="flex-1 grid place-items-center px-6 py-16">
        <div class="max-w-sm text-center">
          <p class="text-xs font-medium uppercase tracking-[0.18em] text-red-500 mb-3">
            500
          </p>
          <h1 class="text-xl font-semibold tracking-(--tracking-tight) text-ink mb-2">
            Something went wrong
          </h1>
          <p class="text-sm text-ink-muted mb-6">{message}</p>
          <a
            href="/"
            class="inline-flex items-center justify-center rounded-lg bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Back to booking
          </a>
        </div>
      </main>
      {cfg && <Footer githubUrl={cfg.githubUrl} hidden={cfg.hideBranding} />}
    </div>
  );
});
