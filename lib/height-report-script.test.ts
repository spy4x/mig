// The script itself, not a restated pure function, is what runs in the
// browser — so unlike guest-tz-script.test.ts (whose comparison logic
// was pulled out into shouldRedirectTz because the inline script has
// no build step and can't otherwise be executed in a Deno test), these
// tests run heightReportScript()'s actual source directly via
// `new Function`, against a hand-built fake `window` that stands in
// for the real DOM global. Every `window.X` the script touches is
// mocked below; nothing here re-implements the script's own decisions.

import { assertEquals } from "@std/assert";
import { HEIGHT_ATTR, heightReportScript } from "./height-report-script.ts";

/** A minimal ResizeObserver stand-in: `observe()` just remembers the
 *  callback so a test can fire it by hand (`trigger()`) to simulate a
 *  layout change, instead of driving a real layout engine. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  callback: () => void;
  observed: FakeElement[] = [];
  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(target: FakeElement) {
    this.observed.push(target);
  }
  trigger() {
    this.callback();
  }
}

/** Stands in for the one element the real script measures — the
 *  `data-mig-height`-marked content wrapper — via `height`, mutable so
 *  a test can simulate the wrapper growing or shrinking between two
 *  reports, same as a real layout change would. */
class FakeElement {
  height: number;
  constructor(height: number) {
    this.height = height;
  }
  getBoundingClientRect(): { height: number } {
    return { height: this.height };
  }
}

interface FakeDocument {
  querySelector(selector: string): FakeElement | null;
  readyState: string;
}

interface FakeWindow {
  parent: FakeWindow;
  document: FakeDocument;
  ResizeObserver?: typeof FakeResizeObserver;
  addEventListener: (type: string, fn: () => void) => void;
  postMessage: (msg: unknown, targetOrigin: string) => void;
  listeners: Record<string, Array<() => void>>;
  posted: Array<{ msg: unknown; targetOrigin: string }>;
}

function fakeWindow(
  opts: {
    framed: boolean;
    element: FakeElement | null;
    withResizeObserver: boolean;
  },
): FakeWindow {
  FakeResizeObserver.instances = [];
  const posted: FakeWindow["posted"] = [];
  const listeners: FakeWindow["listeners"] = {};
  const self: FakeWindow = {
    parent: undefined as unknown as FakeWindow, // set below
    document: {
      querySelector: (selector) =>
        selector === `[${HEIGHT_ATTR}]` ? opts.element : null,
      readyState: "complete",
    },
    ResizeObserver: opts.withResizeObserver ? FakeResizeObserver : undefined,
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    postMessage(msg, targetOrigin) {
      posted.push({ msg, targetOrigin });
    },
    listeners,
    posted,
  };
  self.parent = opts.framed
    ? ({ postMessage: self.postMessage } as unknown as FakeWindow)
    : self;
  return self;
}

function run(win: FakeWindow) {
  new Function("window", heightReportScript())(win);
}

Deno.test("heightReportScript: posts the marked element's height when framed", () => {
  const el = new FakeElement(742);
  const win = fakeWindow({
    framed: true,
    element: el,
    withResizeObserver: true,
  });
  run(win);
  assertEquals(win.posted.length, 1);
  assertEquals(win.posted[0].msg, { type: "mig:height", height: 742 });
  assertEquals(win.posted[0].targetOrigin, "*");
});

Deno.test("heightReportScript: never posts when top-level (window.parent === window)", () => {
  const el = new FakeElement(742);
  const win = fakeWindow({
    framed: false,
    element: el,
    withResizeObserver: true,
  });
  run(win);
  assertEquals(win.posted.length, 0);
});

Deno.test("heightReportScript: never posts when the marked element is missing", () => {
  const win = fakeWindow({
    framed: true,
    element: null,
    withResizeObserver: true,
  });
  run(win);
  assertEquals(win.posted.length, 0);
});

Deno.test("heightReportScript: posts a larger height when the element grows", () => {
  const el = new FakeElement(500);
  const win = fakeWindow({
    framed: true,
    element: el,
    withResizeObserver: true,
  });
  run(win);
  assertEquals(win.posted.length, 1);

  el.height = 900;
  assertEquals(FakeResizeObserver.instances.length, 1);
  FakeResizeObserver.instances[0].trigger();

  assertEquals(win.posted.length, 2);
  assertEquals(win.posted[1].msg, { type: "mig:height", height: 900 });
});

Deno.test("heightReportScript: posts a smaller height when the element shrinks — the height must not be a high-water mark", () => {
  const el = new FakeElement(802);
  const win = fakeWindow({
    framed: true,
    element: el,
    withResizeObserver: true,
  });
  run(win);
  assertEquals(win.posted[0].msg, { type: "mig:height", height: 802 });

  // e.g. a "Change" click back to a step with less content.
  el.height = 654;
  FakeResizeObserver.instances[0].trigger();

  assertEquals(win.posted.length, 2);
  assertEquals(win.posted[1].msg, { type: "mig:height", height: 654 });
});

Deno.test("heightReportScript: rounds a fractional height up", () => {
  const el = new FakeElement(653.2);
  const win = fakeWindow({
    framed: true,
    element: el,
    withResizeObserver: true,
  });
  run(win);
  assertEquals(win.posted[0].msg, { type: "mig:height", height: 654 });
});

Deno.test("heightReportScript: observes the marked element, not the document", () => {
  const el = new FakeElement(300);
  const win = fakeWindow({
    framed: true,
    element: el,
    withResizeObserver: true,
  });
  run(win);
  assertEquals(FakeResizeObserver.instances[0].observed[0], el);
});

Deno.test("heightReportScript: falls back to a resize listener without ResizeObserver", () => {
  const el = new FakeElement(500);
  const win = fakeWindow({
    framed: true,
    element: el,
    withResizeObserver: false,
  });
  run(win);
  assertEquals(win.posted.length, 1);
  const resizeListeners = win.listeners["resize"] ?? [];
  assertEquals(resizeListeners.length, 1);

  el.height = 650;
  resizeListeners[0]();

  assertEquals(win.posted.length, 2);
  assertEquals(win.posted[1].msg, { type: "mig:height", height: 650 });
});

Deno.test("heightReportScript: waits for load when the document isn't ready yet", () => {
  const el = new FakeElement(500);
  const win = fakeWindow({
    framed: true,
    element: el,
    withResizeObserver: true,
  });
  win.document.readyState = "loading";
  run(win);
  // No post yet — the script deferred `start()` to the "load" event.
  assertEquals(win.posted.length, 0);
  const loadListeners = win.listeners["load"] ?? [];
  assertEquals(loadListeners.length, 1);

  loadListeners[0]();
  assertEquals(win.posted.length, 1);
  assertEquals(win.posted[0].msg, { type: "mig:height", height: 500 });
});

Deno.test("heightReportScript: a thrown error inside is swallowed, never surfaces", () => {
  const el = new FakeElement(500);
  const win = fakeWindow({
    framed: true,
    element: el,
    withResizeObserver: true,
  });
  // Typed as FakeDocument | null via the interface above — no `any`
  // needed to exercise the throw-on-access path the try/catch guards.
  (win as unknown as { document: FakeDocument | null }).document = null;
  run(win); // must not throw — the script's own try/catch swallows it
});
