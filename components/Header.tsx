import { BrandMark } from "@spy4x/preact-ui/brand-mark"
import { SiteHeader } from "@spy4x/preact-system/site-header"
import { IconCalendar } from "@spy4x/preact-icons"
import ThemeToggle from "../islands/ThemeToggle.tsx"
import type { ThemeParam } from "../lib/theme.ts"

/*
  mig's top bar: the library's `SiteHeader` with no links, so it draws
  no navigation and no menu button (design-language.md, "Layout
  patterns", a single-page tool). The brand links home; the theme
  toggle is the only action. Host name and zone belong in the page.
  Kept as one component because five routes draw the same bar.
*/

interface HeaderProps {
  /** False hides the theme button, for pages rendered without the theme script (mig#63). */
  themeToggle?: boolean
  /** The owner's `THEME`, the toggle's default when nothing is stored. */
  defaultTheme: ThemeParam
}

export function Header({ themeToggle = true, defaultTheme }: HeaderProps) {
  return (
    <SiteHeader
      brand={
        <a
          href="/"
          class="-m-1 rounded-card p-1 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-focus focus-visible:outline-hidden"
        >
          <BrandMark Icon={IconCalendar} name="mig" />
        </a>
      }
      actions={themeToggle && <ThemeToggle defaultTheme={defaultTheme} />}
    />
  )
}
