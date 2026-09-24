// mig#44 — /embed's forced theme has to apply before first paint, with
// no flash of the wrong colour. Server-rendering the `dark` class and
// `data-theme` attribute directly on <html> is what gets that: these
// tests render the real App layout with a fake `url` (same pattern as
// routes/embed/embed.test.tsx's fakePageProps) and check the rendered
// <html> tag and whether the client bootstrap script — which would
// otherwise read localStorage/prefers-color-scheme and overwrite the
// forced theme on the very first paint — is present.

import { assert, assertFalse } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import type { ComponentProps } from "preact";
import type { PageProps } from "fresh";
import type { State } from "../lib/utils.ts";
import type { Config } from "../lib/types.ts";
import { parseWeeklyAvailability } from "../lib/availability.ts";
import App from "./_app.tsx";

const FAKE_CONFIG: Config = {
  hostName: "Jane Doe",
  hostEmail: "jane@example.com",
  hostTz: "Europe/Berlin",
  meetingUrl: "https://meet.example.com/room",
  publicUrl: "https://mig.example.com",
  weeklyAvailability: parseWeeklyAvailability("MON-FRI 09:00-17:00"),
  slotDurationMin: 30,
  minNoticeHours: 6,
  bookingHorizonDays: 14,
  blockedDates: new Set<string>(),
  rateLimitPer5Min: 1,
  theme: "auto",
  smtp: {
    host: "smtp.example.com",
    port: 587,
    user: "jane@example.com",
    pass: "not-a-real-secret",
    from: "Bookings <book@example.com>",
  },
  cancelSecret: "fake-cancel-secret-only-for-tests",
  port: 8080,
  dataPath: "/tmp/mig-app-test-unused.json",
  hideBranding: false,
  githubUrl: "https://github.com/spy4x/mig",
  version: "test",
};

// App's own props type — `ComponentProps<typeof App>`, derived
// straight from its signature rather than restated — pins `data` to
// `never` (it's the root layout, never a route with its own loader
// data). `Parameters<typeof App>` doesn't work here: Fresh's
// `AnyComponent` union includes a class-constructor variant that
// isn't a plain function signature, so `Parameters<>` rejects it;
// `ComponentProps` (from "preact") extracts a component's props
// either way. Only `state.config` and `url` are read by App — the
// rest are unused stand-ins so the call satisfies the type, same as
// routes/embed/embed.test.tsx's fakePageProps.
function fakeAppProps(path: string): ComponentProps<typeof App> {
  const req = new Request(`http://localhost${path}`);
  const props: PageProps<never, State> = {
    data: undefined as never,
    state: { config: FAKE_CONFIG } as unknown as State,
    config: {} as unknown as PageProps<never, State>["config"],
    url: new URL(req.url),
    req,
    params: {},
    info: {} as unknown as PageProps<never, State>["info"],
    isPartial: false,
    Component: (() => null) as unknown as PageProps<
      never,
      State
    >["Component"],
    error: null,
    route: null,
  };
  return props as unknown as ComponentProps<typeof App>;
}

function htmlTag(html: string): string {
  const m = html.match(/<html\b[^>]*>/);
  if (!m) throw new Error("expected an <html> tag");
  return m[0];
}

Deno.test("App: /embed?theme=dark renders the dark class and data-theme before any script runs", () => {
  const html = renderToString(<App {...fakeAppProps("/embed?theme=dark")} />);
  const tag = htmlTag(html);
  assert(/class="[^"]*\bdark\b[^"]*"/.test(tag), tag);
  assert(tag.includes('data-theme="dark"'), tag);
  assertFalse(
    html.includes("__migTheme"),
    "forced theme must skip the client bootstrap script entirely",
  );
});

Deno.test("App: /embed?theme=light renders no dark class and data-theme=light", () => {
  const html = renderToString(<App {...fakeAppProps("/embed?theme=light")} />);
  const tag = htmlTag(html);
  assertFalse(/class="[^"]*\bdark\b[^"]*"/.test(tag), tag);
  assert(tag.includes('data-theme="light"'), tag);
  assertFalse(html.includes("__migTheme"));
});

Deno.test("App: /embed?theme=auto keeps today's behaviour — no forced class, bootstrap script present", () => {
  const html = renderToString(<App {...fakeAppProps("/embed?theme=auto")} />);
  const tag = htmlTag(html);
  assertFalse(/class="[^"]*\bdark\b[^"]*"/.test(tag), tag);
  assertFalse(tag.includes("data-theme="), tag);
  assert(html.includes("__migTheme"));
});

Deno.test("App: /embed with no theme param at all behaves exactly like ?theme=auto", () => {
  const html = renderToString(<App {...fakeAppProps("/embed")} />);
  const tag = htmlTag(html);
  assertFalse(/class="[^"]*\bdark\b[^"]*"/.test(tag), tag);
  assertFalse(tag.includes("data-theme="), tag);
  assert(html.includes("__migTheme"));
});

Deno.test("App: an invalid /embed?theme= value falls back to auto, never reflected unescaped", () => {
  const html = renderToString(
    <App
      {...fakeAppProps(
        "/embed?theme=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E",
      )}
    />,
  );
  const tag = htmlTag(html);
  assertFalse(/class="[^"]*\bdark\b[^"]*"/.test(tag), tag);
  assertFalse(tag.includes("data-theme="), tag);
  assertFalse(html.toLowerCase().includes("<script>alert"));
});

Deno.test("App: ?theme=dark on the standalone site (not /embed) is ignored", () => {
  // The standalone site never advertises a `?theme=` param — this
  // guards against it silently starting to honour one meant only for
  // /embed.
  const html = renderToString(<App {...fakeAppProps("/?theme=dark")} />);
  const tag = htmlTag(html);
  assertFalse(/class="[^"]*\bdark\b[^"]*"/.test(tag), tag);
  assertFalse(tag.includes("data-theme="), tag);
  assert(html.includes("__migTheme"));
});

Deno.test("App: /embed/confirmed?theme=dark also forces the theme (not just /embed's picker)", () => {
  const html = renderToString(
    <App {...fakeAppProps("/embed/confirmed?theme=dark")} />,
  );
  const tag = htmlTag(html);
  assert(/class="[^"]*\bdark\b[^"]*"/.test(tag), tag);
  assert(tag.includes('data-theme="dark"'), tag);
});

// ─── mig#44 review: color-scheme, and never writing mig-theme ────────

Deno.test("App: a forced theme sets color-scheme on <html> to that one scheme (scrollbars, autofill)", () => {
  const darkTag = htmlTag(
    renderToString(<App {...fakeAppProps("/embed?theme=dark")} />),
  );
  assert(
    darkTag.includes("color-scheme: dark") ||
      darkTag.includes("color-scheme:dark"),
    darkTag,
  );
  assertFalse(darkTag.includes("color-scheme: light"), darkTag);

  const lightTag = htmlTag(
    renderToString(<App {...fakeAppProps("/embed?theme=light")} />),
  );
  assert(
    lightTag.includes("color-scheme: light") ||
      lightTag.includes("color-scheme:light"),
    lightTag,
  );
  assertFalse(lightTag.includes("color-scheme: dark"), lightTag);
});

Deno.test("App: theme=auto sets no color-scheme style on <html> (unchanged from before mig#44)", () => {
  const tag = htmlTag(
    renderToString(<App {...fakeAppProps("/embed?theme=auto")} />),
  );
  assertFalse(tag.includes("color-scheme"), tag);
});

Deno.test("App: a forced theme never renders a script that writes the mig-theme localStorage key", () => {
  // The standalone site and /embed share an origin and read/write the
  // same "mig-theme" key (lib/theme.ts's themeBootstrapScript). An
  // explicit ?theme= must override what that key decides without ever
  // touching it — otherwise picking a theme in one embed would leak
  // into the standalone site's own stored preference, or a later
  // ?theme=auto load.
  for (const path of ["/embed?theme=dark", "/embed?theme=light"]) {
    const html = renderToString(<App {...fakeAppProps(path)} />);
    assertFalse(html.includes("mig-theme"), `${path}: ${html}`);
    assertFalse(html.includes("localStorage"), `${path}: ${html}`);
  }
});

Deno.test("App: theme=auto still renders the script that reads/writes mig-theme", () => {
  const html = renderToString(<App {...fakeAppProps("/embed?theme=auto")} />);
  assert(html.includes("mig-theme"));
  assert(html.includes("localStorage"));
});
