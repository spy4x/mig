// mig#52 — the owner's `THEME` is the default theme for a visitor with
// nothing stored. These tests run the real bootstrap script against a
// fake `localStorage`, `matchMedia` and `document`, and read back the
// theme it applied to <html>.

import { assertEquals } from "@std/assert";
import { themeBootstrapScript, type ThemeParam } from "./theme.ts";

interface Run {
  theme: string | undefined;
  dark: boolean;
  mode: string;
}

function run(
  defaultMode: ThemeParam | undefined,
  stored: string | null,
  systemDark: boolean,
): Run {
  const store = new Map<string, string>();
  if (stored !== null) store.set("mig-theme", stored);
  const classes = new Set<string>();
  const html = {
    dataset: {} as Record<string, string>,
    classList: {
      toggle: (c: string, on: boolean) =>
        on ? classes.add(c) : classes.delete(c),
    },
  };
  const win: { __migTheme?: { mode: () => string } } = {};
  const script = defaultMode === undefined
    ? themeBootstrapScript()
    : themeBootstrapScript(defaultMode);
  new Function("localStorage", "matchMedia", "document", "window", script)(
    {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
    () => ({ matches: systemDark, addEventListener: () => {} }),
    { documentElement: html },
    win,
  );
  return {
    theme: html.dataset.theme,
    dark: classes.has("dark"),
    mode: win.__migTheme?.mode() ?? "missing",
  };
}

Deno.test("theme script: THEME=dark renders dark for a visitor with nothing stored", () => {
  assertEquals(run("dark", null, false), {
    theme: "dark",
    dark: true,
    mode: "dark",
  });
});

Deno.test("theme script: THEME=light renders light for a visitor with nothing stored", () => {
  assertEquals(run("light", null, true), {
    theme: "light",
    dark: false,
    mode: "light",
  });
});

Deno.test("theme script: a stored preference wins over THEME", () => {
  assertEquals(run("dark", "light", true).theme, "light");
  assertEquals(run("light", "dark", false).theme, "dark");
});

Deno.test("theme script: a stored auto follows the system even when THEME is set", () => {
  assertEquals(run("dark", "auto", false), {
    theme: "light",
    dark: false,
    mode: "auto",
  });
});

Deno.test("theme script: THEME=auto with nothing stored follows the system", () => {
  assertEquals(run("auto", null, true).theme, "dark");
  assertEquals(run("auto", null, false).theme, "light");
  assertEquals(run(undefined, null, true).theme, "dark");
});

Deno.test("theme script: an unknown THEME value is written into the script as auto", () => {
  const script = themeBootstrapScript(`"+alert(1)+"` as ThemeParam);
  assertEquals(script.includes("alert"), false);
  assertEquals(run("nonsense" as ThemeParam, null, true).theme, "dark");
});
