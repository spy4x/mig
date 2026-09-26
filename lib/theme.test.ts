// mig#52 — the owner's `THEME` is the default theme for a visitor with
// nothing stored. These tests run the real first-paint script against a
// fake `localStorage`, `matchMedia` and `document`, and read back the
// theme it applied to <html> and what is stored afterwards.

import { assertEquals } from "@std/assert";
import { THEME_STORAGE_KEY, type ThemeParam, themeScript } from "./theme.ts";

interface Run {
  dark: boolean;
  stored: string | null;
}

function run(
  defaultMode: ThemeParam | undefined,
  stored: string | null,
  systemDark: boolean,
): Run {
  const store = new Map<string, string>();
  if (stored !== null) store.set(THEME_STORAGE_KEY, stored);
  const classes = new Set<string>();
  const html = {
    classList: {
      toggle: (c: string, on: boolean) =>
        on ? classes.add(c) : classes.delete(c),
    },
  };
  const script = defaultMode === undefined
    ? themeScript()
    : themeScript(defaultMode);
  new Function("localStorage", "matchMedia", "document", script)(
    {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
    () => ({ matches: systemDark }),
    { documentElement: html },
  );
  return {
    dark: classes.has("dark"),
    stored: store.get(THEME_STORAGE_KEY) ?? null,
  };
}

Deno.test("theme script: THEME=dark renders dark for a visitor with nothing stored", () => {
  assertEquals(run("dark", null, false), { dark: true, stored: null });
});

Deno.test("theme script: THEME=light renders light for a visitor with nothing stored", () => {
  assertEquals(run("light", null, true), { dark: false, stored: null });
});

Deno.test("theme script: a stored preference wins over THEME", () => {
  assertEquals(run("dark", "light", true).dark, false);
  assertEquals(run("light", "dark", false).dark, true);
});

Deno.test("theme script: a stored system preference follows the system even when THEME is set", () => {
  assertEquals(run("dark", "system", false).dark, false);
  assertEquals(run("light", "system", true).dark, true);
});

Deno.test("theme script: a stored auto from before the shared store keeps following the system and is migrated to system", () => {
  assertEquals(run("dark", "auto", false), { dark: false, stored: "system" });
  assertEquals(run("light", "auto", true), { dark: true, stored: "system" });
});

Deno.test("theme script: THEME=auto with nothing stored follows the system", () => {
  assertEquals(run("auto", null, true).dark, true);
  assertEquals(run("auto", null, false).dark, false);
  assertEquals(run(undefined, null, true).dark, true);
});

Deno.test("theme script: an unknown THEME value is written into the script as auto", () => {
  const script = themeScript(`"+alert(1)+"` as ThemeParam);
  assertEquals(script.includes("alert"), false);
  assertEquals(run("nonsense" as ThemeParam, null, true).dark, true);
});
