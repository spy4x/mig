import { Logo } from "./Logo.tsx";
import ThemeToggle from "../islands/ThemeToggle.tsx";

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
}

export function Header({ compact = false }: HeaderProps) {
  return (
    <header
      class={`sticky top-0 z-40 w-full border-b border-line bg-surface/80 backdrop-blur-md backdrop-saturate-150 ${
        compact ? "" : ""
      }`}
    >
      <div class="mx-auto flex w-full max-w-2xl items-center justify-between px-4 sm:px-6 py-4 sm:py-5">
        <Logo size={28} href="/" />
        <ThemeToggle />
      </div>
    </header>
  );
}
