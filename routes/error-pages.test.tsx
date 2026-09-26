// mig#63 — on /embed with a forced theme, routes/_app.tsx leaves out the
// theme bootstrap script, so the theme button on the not-found and error
// pages would do nothing. These tests render both pages and check that
// the button is hidden exactly when the theme is forced.

import { assert, assertFalse } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import type { State } from "../lib/utils.ts";
import type { Config } from "../lib/types.ts";
import NotFound from "./_404.tsx";
import ErrorPage from "./_500.tsx";

// Only the fields the two pages read; the rest of Config is never touched.
function fakeProps(path: string, theme: Config["theme"]) {
  const config = {
    theme,
    githubUrl: "https://github.com/spy4x/mig",
    hideBranding: false,
    version: "test",
  } as unknown as Config;
  return {
    state: { config } as unknown as State,
    url: new URL(`http://localhost${path}`),
    error: new Error("boom"),
  };
}

// The unhydrated ThemeToggle island renders this placeholder label.
const TOGGLE = `aria-label="Toggle theme"`;

function render404(path: string, theme: Config["theme"]): string {
  // deno-lint-ignore no-explicit-any
  return renderToString(<NotFound {...(fakeProps(path, theme) as any)} />);
}

function render500(path: string, theme: Config["theme"]): string {
  // deno-lint-ignore no-explicit-any
  return renderToString(<ErrorPage {...(fakeProps(path, theme) as any)} />);
}

Deno.test("404: /embed with THEME=dark shows no theme button", () => {
  assertFalse(render404("/embed/nope", "dark").includes(TOGGLE));
});

Deno.test("404: /embed?theme=light with THEME=auto shows no theme button", () => {
  assertFalse(render404("/embed/nope?theme=light", "auto").includes(TOGGLE));
});

Deno.test("404: /embed with THEME=auto keeps the theme button", () => {
  assert(render404("/embed/nope", "auto").includes(TOGGLE));
});

Deno.test("404: the standalone site keeps the theme button with THEME=dark", () => {
  assert(render404("/nope", "dark").includes(TOGGLE));
});

Deno.test("500: /embed with THEME=light shows no theme button", () => {
  assertFalse(render500("/embed/boom", "light").includes(TOGGLE));
});

Deno.test("500: the standalone site keeps the theme button with THEME=light", () => {
  assert(render500("/boom", "light").includes(TOGGLE));
});
