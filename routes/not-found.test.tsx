// mig#68 — a missing page rendered "Page not found" but answered 200,
// so a crawler or an uptime check would take it for a real page. Fresh renders
// routes/_404.tsx with 200 unless the route's handler sets a status.
// These tests serve requests through a real Fresh `App` whose file
// routes are loaded the way the production build loads them (a build
// snapshot handed to `ProdBuildCache`), with mig's own `_app`, `_404`
// and `_500` modules, and check the status code of each response.

import { assertEquals, assertStringIncludes } from "@std/assert";
import { App } from "fresh";
import { ProdBuildCache, setBuildCache } from "fresh/internal";
import type { State } from "../lib/utils.ts";
import type { Config } from "../lib/types.ts";
import * as appRoute from "./_app.tsx";
import * as notFoundRoute from "./_404.tsx";
import * as errorRoute from "./_500.tsx";
import * as healthRoute from "./health.ts";

// Only the fields the layout and the error pages read.
const CONFIG = {
  hostName: "Jane Doe",
  slotDurationMin: 30,
  publicUrl: "https://mig.example.com",
  theme: "auto",
  githubUrl: "https://github.com/spy4x/mig",
  hideBranding: false,
  version: "test",
} as unknown as Config;

// Same shape as the `fsRoutes` list the Vite build writes into
// _fresh/server/server-entry.mjs, plus a route that throws.
const FS_ROUTES = [
  { id: "/_app", mod: appRoute, type: "app", pattern: "*", routePattern: "*" },
  {
    id: "/_404",
    mod: notFoundRoute,
    type: "notFound",
    pattern: "*",
    routePattern: "*",
  },
  {
    id: "/_500",
    mod: errorRoute,
    type: "error",
    pattern: "/",
    routePattern: "/",
  },
  {
    id: "/health",
    mod: healthRoute,
    type: "route",
    pattern: "/health",
    routePattern: "/health",
  },
  {
    id: "/boom",
    mod: {
      handler: () => {
        throw new Error("boom");
      },
    },
    type: "route",
    pattern: "/boom",
    routePattern: "/boom",
  },
];

function handler(): (req: Request) => Promise<Response> {
  const app = new App<State>();
  app.use((ctx) => {
    ctx.state.config = CONFIG;
    ctx.state.bookings = { list: () => [] } as unknown as State["bookings"];
    return ctx.next();
  });
  app.fsRoutes();
  const cache = new ProdBuildCache<State>(Deno.cwd(), {
    version: "test",
    clientEntry: "/client.js",
    // deno-lint-ignore no-explicit-any
    fsRoutes: FS_ROUTES as any,
    staticFiles: new Map(),
    islands: new Map(),
    entryAssets: [],
  });
  setBuildCache(app, cache, "production");
  return app.handler();
}

async function get(path: string): Promise<{ status: number; body: string }> {
  const res = await handler()(new Request(`http://localhost${path}`));
  return { status: res.status, body: await res.text() };
}

for (const path of ["/nope", "/embed/nope"]) {
  Deno.test(`mig#68: ${path} answers 404 with the not-found page`, async () => {
    const { status, body } = await get(path);
    assertEquals(status, 404);
    assertStringIncludes(body, "Page not found");
  });
}

Deno.test("mig#68: an existing route still answers 200", async () => {
  const { status, body } = await get("/health");
  assertEquals(status, 200);
  assertEquals(body, "ok\n");
});

Deno.test("mig#68: a route that throws still answers 500 with the error page", async () => {
  const { status, body } = await get("/boom");
  assertEquals(status, 500);
  assertStringIncludes(body, "Something went wrong");
});
