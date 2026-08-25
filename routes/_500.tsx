import { define } from "../lib/utils.ts";

export default define.page(function Error(
  // deno-lint-ignore no-explicit-any
  { error }: { error?: any },
) {
  const message = error?.message ?? "Unexpected error.";
  return (
    <main class="min-h-screen flex items-center justify-center p-6">
      <div class="text-center max-w-md">
        <h1 class="text-3xl font-semibold mb-2 text-slate-200">
          Something went wrong
        </h1>
        <p class="text-slate-400 mb-6">{message}</p>
        <a
          href="/"
          class="inline-block px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium transition-colors"
        >
          Back to booking
        </a>
      </div>
    </main>
  );
});
