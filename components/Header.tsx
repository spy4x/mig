import { BrandMark } from "@spy4x/preact-ui/brand-mark"
import { IconCalendar } from "@spy4x/preact-icons"
import ThemeToggle from "../islands/ThemeToggle.tsx"
import type { ThemeParam } from "../lib/theme.ts"

/*
  Top bar of a single-page tool (design-language.md, "Layout
  patterns"): the brand mark on the left, the theme toggle on the
  right, nothing else. Host name and zone belong in the page, not here.
*/

interface HeaderProps {
  /** False hides the theme button, for pages rendered without the theme script (mig#63). */
  themeToggle?: boolean
  /** The owner's `THEME`, the toggle's default when nothing is stored. */
  defaultTheme: ThemeParam
}

export function Header({ themeToggle = true, defaultTheme }: HeaderProps) {
  return (
    <header class="w-full border-b border-subtle">
      <div class="mx-auto flex w-full max-w-2xl items-center justify-between px-4 py-3 sm:px-6">
        <a
          href="/"
          class="-m-1 rounded-card p-1 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-focus focus-visible:outline-hidden"
        >
          <BrandMark Icon={IconCalendar} name="mig" />
        </a>
        {themeToggle && <ThemeToggle defaultTheme={defaultTheme} />}
      </div>
    </header>
  )
}
