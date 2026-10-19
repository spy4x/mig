import { useEffect, useMemo } from "preact/hooks"
import { createThemeStore } from "@spy4x/preact-signals/theme"
import { ThemeToggle as LibraryThemeToggle } from "@spy4x/preact-ui/theme-toggle"
import {
  THEME_STORAGE_KEY,
  type ThemeParam,
  themePreference,
} from "../lib/theme.ts"

/*
  Theme toggle island: the library's ThemeToggle on a theme store with
  the same storage key and default as lib/theme.ts's first-paint script.
  The store stores the choice, repaints and follows system changes once
  attached; the button only reads it and cycles it.
*/

interface ThemeToggleProps {
  /** The owner's `THEME`: the preference when the visitor stored none. */
  defaultTheme: ThemeParam
}

export default function ThemeToggle({ defaultTheme }: ThemeToggleProps) {
  // Creating the store reads nothing, so this is safe during SSR;
  // `attach()` in the effect is the first read of storage.
  const store = useMemo(
    () =>
      createThemeStore({
        storageKey: THEME_STORAGE_KEY,
        defaultPreference: themePreference(defaultTheme),
      }),
    [defaultTheme],
  )
  useEffect(() => store.attach(), [store])
  return <LibraryThemeToggle store={store} />
}
