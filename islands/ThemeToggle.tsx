import { useEffect, useMemo, useState } from "preact/hooks";
import {
  createThemeStore,
  type ThemePreference,
  ThemeValue,
} from "@spy4x/preact-signals/theme";
import { Moon, Sun, ThemeAuto } from "../components/icons.tsx";
import {
  THEME_STORAGE_KEY,
  type ThemeParam,
  themePreference,
} from "../lib/theme.ts";

/*
  Theme toggle island.

  Cycles through system → light → dark → system. The state lives in
  @spy4x/preact-signals' theme store, attached on mount with the same
  storage key and default as lib/theme.ts's first-paint script; it
  stores the choice, repaints and follows system changes.

  Why a cycle, not a tri-state dropdown: the affordance is small (one
  icon button in the header). A cycle lets the user see + control the
  setting without ever opening a popover. The order is system first
  because that's the safe default.

  Sun = light, moon = dark, the half-moon "auto" icon = following the
  system.
*/

export function nextPreference(p: ThemePreference): ThemePreference {
  return p === ThemeValue.SYSTEM
    ? ThemeValue.LIGHT
    : p === ThemeValue.LIGHT
    ? ThemeValue.DARK
    : ThemeValue.SYSTEM;
}

function label(p: ThemePreference): string {
  return p === ThemeValue.SYSTEM
    ? "Theme: follows system. Click for light."
    : p === ThemeValue.LIGHT
    ? "Theme: light. Click for dark."
    : "Theme: dark. Click for auto.";
}

function Icon({ preference }: { preference: ThemePreference }) {
  if (preference === ThemeValue.LIGHT) return <Sun />;
  if (preference === ThemeValue.DARK) return <Moon />;
  return <ThemeAuto />;
}

interface ThemeToggleProps {
  /** The owner's `THEME`: the preference when the visitor stored none. */
  defaultTheme: ThemeParam;
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
  );
  const [preference, setPreference] = useState<ThemePreference>(
    ThemeValue.SYSTEM,
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const detach = store.attach();
    // `subscribe`, not an auto-tracked read: the store's signals may be
    // a different copy of @preact/signals than this island renders with.
    const unsubscribe = store.preference.subscribe(setPreference);
    setMounted(true);
    return () => {
      unsubscribe();
      detach();
    };
  }, [store]);

  // Until mounted, render a placeholder with the same dimensions so the
  // layout doesn't shift when the real button hydrates.
  const base =
    "relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-raised text-ink-muted hover:text-ink hover:bg-surface-sunken transition-colors duration-(--duration-snappy) focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Toggle theme"
        class={`${base} opacity-0`}
        tabIndex={-1}
      >
        <Icon preference={ThemeValue.SYSTEM} />
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={label(preference)}
      title={label(preference)}
      onClick={() => store.set(nextPreference(store.preference.value))}
      class={base}
    >
      <Icon preference={preference} />
    </button>
  );
}
