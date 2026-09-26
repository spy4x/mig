import { Logo } from "./Logo.tsx";
import ThemeToggle from "../islands/ThemeToggle.tsx";
import type { ThemeParam } from "../lib/theme.ts";

/*
  Top app chrome. Slim, sticky, hairline bottom border, blurred
  background so content scrolls under it cleanly.

  No host name / tz in here — those belong in the hero, not the
  chrome. The header is brand-only: mark on the left, theme toggle
  on the right.
*/

interface HeaderProps {
  /** Used by the embed variant to swap to a tighter header. */
  compact?: boolean;
  /** False hides the theme button, for pages rendered without the theme script (mig#63). */
  themeToggle?: boolean;
  /** The owner's `THEME`, the toggle's default when nothing is stored. */
  defaultTheme: ThemeParam;
}

export function Header(
  { compact = false, themeToggle = true, defaultTheme }: HeaderProps,
) {
  return (
    <header
      class={`sticky top-0 z-40 w-full border-b border-line bg-surface/80 backdrop-blur-md backdrop-saturate-150 ${
        compact ? "" : ""
      }`}
    >
      <div class="mx-auto flex w-full max-w-2xl items-center justify-between px-4 sm:px-6 py-4 sm:py-5">
        <Logo size={28} href="/" />
        {themeToggle && <ThemeToggle defaultTheme={defaultTheme} />}
      </div>
    </header>
  );
}
