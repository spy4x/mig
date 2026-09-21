// Issue #11 — the embed flow must stay self-contained: every link and
// form action a visitor can reach from /embed must stay under /embed,
// until they open the meeting link or cancel (both leave on purpose,
// in a new tab). A host that only allows framing for /embed relies on
// this — one link back out to `/` and the browser refuses to render
// the next page inside the iframe.
//
// These tests call the route/component functions directly with
// hand-built props instead of going through Fresh's router — Fresh
// only resolves its file-system routes and island hydration through
// the Vite build, which the CI pipeline runs *after* `deno test`, so
// a router-level test would either be stale or need a build step
// unsafe to run before every mutation. Calling the exported page
// components directly still exercises the exact JSX Fresh renders
// for each route; it just skips the query-string parsing in each
// route's `handler.GET`, which this issue doesn't touch.

import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import type { PageProps } from "fresh";
import type { State } from "../../lib/utils.ts";
import type { Config } from "../../lib/types.ts";
import type { ConfirmedData } from "../../lib/confirmed-data.ts";
import { Picker } from "../../components/Picker.tsx";
import EmbedPage, { type EmbedData } from "./index.tsx";
import EmbedConfirmedPage from "./confirmed.tsx";
import ConfirmedPage from "../confirmed.tsx";

// ─── Fixtures ──────────────────────────────────────────────────────

const FAKE_CONFIG: Config = {
  hostName: "Jane Doe",
  hostEmail: "jane@example.com",
  hostTz: "Europe/Berlin",
  meetingUrl: "https://meet.example.com/room",
  publicUrl: "https://mig.example.com",
  weeklyAvailability: {
    MON: [],
    TUE: [],
    WED: [],
    THU: [],
    FRI: [],
    SAT: [],
    SUN: [],
  },
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
  dataPath: "/tmp/mig-embed-test-bookings.json",
  hideBranding: false,
  githubUrl: "https://github.com/spy4x/mig",
  version: "test",
};

const DATES: EmbedData["dates"] = [
  { date: "2027-01-04", slots: 3 },
  { date: "2027-01-05", slots: 0 },
  { date: "2027-01-06", slots: 5 },
];

const SLOTS: EmbedData["slots"] = [
  { time: "09:00", available: true },
  { time: "09:30", available: false },
];

// Builds the full PageProps a route's default component receives.
// Only `data` and `state.config` are read by the components under
// test here — the rest are unused stand-ins so the call satisfies
// Fresh's PageProps type.
function fakePageProps<Data>(data: Data): PageProps<Data, State> {
  const req = new Request("http://localhost/embed");
  return {
    data,
    state: { config: FAKE_CONFIG } as unknown as State,
    config: {} as unknown as PageProps<Data, State>["config"],
    url: new URL(req.url),
    req,
    params: {},
    info: {} as unknown as PageProps<Data, State>["info"],
    isPartial: false,
    Component: (() => null) as unknown as PageProps<Data, State>["Component"],
    error: null,
    route: null,
  };
}

function embedData(overrides: Partial<EmbedData>): EmbedData {
  return {
    date: null,
    slot: null,
    dates: DATES,
    selectedDateLabel: null,
    slots: [],
    monthAnchor: "2027-01-01",
    error: null,
    ...overrides,
  };
}

function confirmedData(overrides: Partial<ConfirmedData>): ConfirmedData {
  return {
    state: "ok",
    mode: "booked",
    booking: {
      id: "01JBOOKINGFAKE00000000000",
      date: "2027-01-04",
      time: "09:00",
      hostTz: "Europe/Berlin",
      guestTz: null,
      guestName: "Visitor",
      guestEmail: "visitor@example.com",
      cancelToken: "faketoken",
    },
    ...overrides,
  };
}

// ─── HTML introspection ──────────────────────────────────────────────
// No DOM parser in scope (no new dependency for it) — the markup here
// is simple enough that matching opening tags is exact and readable.

interface Anchor {
  href: string;
  target: string | null;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function anchors(html: string): Anchor[] {
  const tags = html.match(/<a\b[^>]*>/g) ?? [];
  return tags.map((tag) => ({
    href: attr(tag, "href") ?? "",
    target: attr(tag, "target"),
  }));
}

function formActions(html: string): string[] {
  const tags = html.match(/<form\b[^>]*>/g) ?? [];
  return tags.map((tag) => attr(tag, "action") ?? "");
}

/** Every href/action must start with `base`, except entries in
 *  `allow` (matched exactly). Returns the offending values so a
 *  failure message names them instead of just "not equal". */
function offendingLinks(
  links: string[],
  base: string,
  allow: string[] = [],
): string[] {
  return links.filter((l) => !l.startsWith(base) && !allow.includes(l));
}

// ─── /embed (picker) ─────────────────────────────────────────────────

Deno.test("embed picker: date step — every link stays under /embed", () => {
  const html = renderToString(
    <EmbedPage {...fakePageProps(embedData({}))} />,
  );
  const links = [
    ...anchors(html).map((a) => a.href),
    ...formActions(html),
  ];
  assertEquals(offendingLinks(links, "/embed"), []);
  assert(links.length > 0, "expected at least one link to check");
});

Deno.test("embed picker: time step — date-card and slot links stay under /embed", () => {
  const html = renderToString(
    <EmbedPage
      {...fakePageProps(embedData({
        date: "2027-01-04",
        selectedDateLabel: "Monday, 4 January 2027",
        slots: SLOTS,
      }))}
    />,
  );
  const links = [
    ...anchors(html).map((a) => a.href),
    ...formActions(html),
  ];
  assertEquals(offendingLinks(links, "/embed"), []);
  // The date-card "Change" link and the one available slot link must
  // be present (the booked 09:30 slot renders as a disabled <span>,
  // not a link).
  assert(links.length >= 2, `expected >=2 links, got ${links.length}`);
});

Deno.test("embed picker: confirm step — form posts to /embed/book, captures guestTz without an island", () => {
  const html = renderToString(
    <EmbedPage
      {...fakePageProps(embedData({
        date: "2027-01-04",
        selectedDateLabel: "Monday, 4 January 2027",
        slot: "09:00",
        slots: SLOTS,
      }))}
    />,
  );
  const links = [
    ...anchors(html).map((a) => a.href),
    ...formActions(html),
  ];
  assertEquals(offendingLinks(links, "/embed"), []);
  assertEquals(formActions(html), ["/embed/book"]);
  // The progressive-enhancement guestTz capture: a hidden input the
  // inline script below fills in, no island required.
  assert(html.includes('name="guestTz"'), "expected a hidden guestTz input");
  assert(
    html.includes("Intl.DateTimeFormat"),
    "expected the inline timezone-capture script",
  );
  // No module script anywhere — Fresh only emits island hydration
  // `<script type="module">` tags through the real Vite build (this
  // render doesn't go through it, see the file header comment), but a
  // literal type="module" here would still be a real regression.
  assertFalse(html.includes('<script type="module"'));
});

Deno.test("embed form never renders BookingSubmit, the standalone island", async () => {
  // Complements the routes/embed/*.tsx import check below: BookingForm
  // legitimately imports islands/BookingSubmit.tsx (the standalone
  // page still uses it), so a blanket "no islands/ import" check on
  // that file would false-positive. This instead pins the one line
  // that decides which branch runs for basePath !== "": PlainSubmitButton
  // for embed, BookingSubmit only for the standalone default.
  const source = await Deno.readTextFile(
    new URL("../../components/BookingForm.tsx", import.meta.url),
  );
  assert(
    /embed\s*\?\s*<PlainSubmitButton/.test(source),
    "expected the embed branch of the submit-button ternary to render PlainSubmitButton",
  );
});

Deno.test("embed picker: month navigation links stay under /embed", () => {
  const html = renderToString(
    <EmbedPage {...fakePageProps(embedData({ monthAnchor: "2027-02-01" }))} />,
  );
  const links = anchors(html).map((a) => a.href);
  const monthLinks = links.filter((l) => l.includes("month="));
  assert(monthLinks.length > 0, "expected prev/next month links");
  assertEquals(offendingLinks(links, "/embed"), []);
});

// lib/book.ts's errRedirect never passes both `date` and `slot` back —
// only rate-limit/validation failures (neither param) or
// availability/persist failures (date only). Those are the only two
// states the embed page's error banner actually has to render in.
// Before this fix the banner lived inside BookingForm, which Picker
// only renders at step 3 (date + slot both chosen) — a state the
// server never redirects to with ?err=, so a failed booking inside
// the frame showed no error at all.

Deno.test("embed picker: error banner is visible with a date but no slot (step 2)", () => {
  const html = renderToString(
    <EmbedPage
      {...fakePageProps(embedData({
        date: "2027-01-04",
        selectedDateLabel: "Monday, 4 January 2027",
        slots: SLOTS,
        error: "That time is no longer available.",
      }))}
    />,
  );
  assert(html.includes("That time is no longer available."));
  assert(html.includes('role="alert"'));
  const links = [
    ...anchors(html).map((a) => a.href),
    ...formActions(html),
  ];
  assertEquals(offendingLinks(links, "/embed"), []);
});

Deno.test("embed picker: error banner is visible with neither date nor slot (step 1)", () => {
  const html = renderToString(
    <EmbedPage
      {...fakePageProps(embedData({
        error: "Too many attempts. Try again in 3 minutes.",
      }))}
    />,
  );
  assert(html.includes("Too many attempts. Try again in 3 minutes."));
  assert(html.includes('role="alert"'));
  const links = [
    ...anchors(html).map((a) => a.href),
    ...formActions(html),
  ];
  assertEquals(offendingLinks(links, "/embed"), []);
});

Deno.test("embed pages render no header, footer, or theme toggle", () => {
  const pickerHtml = renderToString(
    <EmbedPage {...fakePageProps(embedData({}))} />,
  );
  const confirmedHtml = renderToString(
    <EmbedConfirmedPage {...fakePageProps(confirmedData({}))} />,
  );
  for (const html of [pickerHtml, confirmedHtml]) {
    assertFalse(html.includes("<header"));
    assertFalse(html.includes("<footer"));
    assertFalse(html.includes('aria-label="Toggle theme"'));
  }
});

Deno.test("embed pages give the Skip-to-content link (#main, routes/_app.tsx) a target", () => {
  const pickerHtml = renderToString(
    <EmbedPage {...fakePageProps(embedData({}))} />,
  );
  for (const mode of ["booked", "cancelled"] as const) {
    const confirmedHtml = renderToString(
      <EmbedConfirmedPage {...fakePageProps(confirmedData({ mode }))} />,
    );
    assert(
      confirmedHtml.includes('id="main"'),
      `expected id="main" for mode=${mode}`,
    );
  }
  assert(pickerHtml.includes('id="main"'));
});

// ─── /embed/confirmed ─────────────────────────────────────────────────

Deno.test("embed confirmed: booked state keeps links under /embed except the meeting and cancel links, both opening in a new tab", () => {
  const html = renderToString(
    <EmbedConfirmedPage {...fakePageProps(confirmedData({}))} />,
  );
  const all = anchors(html);
  const external = all.filter((a) => !a.href.startsWith("/embed"));

  // Exactly the meeting link and the cancel link may leave /embed.
  const meeting = external.find((a) => a.href === FAKE_CONFIG.meetingUrl);
  const cancel = external.find((a) => a.href.startsWith("/cancel"));
  assertEquals(
    external.length,
    2,
    `unexpected external links: ${JSON.stringify(external)}`,
  );
  assert(meeting, "expected the meeting link");
  assert(cancel, "expected the cancel link");
  assertEquals(meeting?.target, "_blank");
  assertEquals(cancel?.target, "_blank");
});

Deno.test("embed confirmed: cancelled state links stay under /embed", () => {
  const html = renderToString(
    <EmbedConfirmedPage
      {...fakePageProps(confirmedData({ mode: "cancelled" }))}
    />,
  );
  const links = anchors(html).map((a) => a.href);
  assert(links.length > 0);
  assertEquals(offendingLinks(links, "/embed"), []);
});

for (const state of ["missing", "invalid", "expired"] as const) {
  Deno.test(`embed confirmed: ${state} link stays under /embed booking not found`, () => {
    const html = renderToString(
      <EmbedConfirmedPage
        {...fakePageProps(confirmedData({ state, booking: null }))}
      />,
    );
    const links = anchors(html).map((a) => a.href);
    assertEquals(links, ["/embed"]);
  });
}

// ─── Baseline: default basePath must still be "/" ───────────────────
// Guards against the base path default silently changing for the
// standalone page, which shares these same components.

Deno.test("picker defaults to root links when basePath is omitted", () => {
  const html = renderToString(
    <Picker
      dates={DATES}
      slots={SLOTS}
      selectedDate="2027-01-04"
      selectedDateLabel="Monday, 4 January 2027"
      selectedSlot="09:00"
      monthAnchor="2027-01-01"
      durationMin={30}
      hostName="Jane Doe"
      hostTz="Europe/Berlin"
      error={null}
      confirmLabel="Confirm — Mon, 4 Jan, 09:00"
    />,
  );
  const links = [...anchors(html).map((a) => a.href), ...formActions(html)];
  for (const link of links) {
    assert(
      link === "/" || link.startsWith("/?") || link === "/api/book",
      `expected a root link, got "${link}"`,
    );
  }
  assertEquals(formActions(html), ["/api/book"]);
  // Standalone keeps the BookingSubmit island (guestTz capture).
  assert(html.includes('name="guestTz"'));
});

Deno.test("standalone confirmed page keeps header, footer, and same-tab cancel link", () => {
  const html = renderToString(
    <ConfirmedPage {...fakePageProps(confirmedData({}))} />,
  );
  assert(html.includes("<header"));
  assert(html.includes("<footer"));
  const cancel = anchors(html).find((a) => a.href.startsWith("/cancel"));
  assert(cancel, "expected the cancel link");
  assertEquals(cancel?.target, null);
  const back = anchors(html).find((a) => a.href === "/");
  assert(back, "expected a link back to /");
});

Deno.test("standalone confirmed page's cancelled state keeps its original padding", () => {
  // Regression guard: the ConfirmedView extraction briefly changed the
  // cancelled state's <main> from px-6 py-16 (its original class,
  // matching the not-ok state) to px-4 sm:px-6 py-12 (the booked
  // state's class) — a visible, unintended behaviour change on the
  // standalone page a "no behaviour change" refactor must not make.
  const html = renderToString(
    <ConfirmedPage
      {...fakePageProps(confirmedData({ mode: "cancelled" }))}
    />,
  );
  assert(html.includes('class="flex-1 grid place-items-center px-6 py-16"'));
  assertFalse(
    html.includes('class="flex-1 grid place-items-center px-4 sm:px-6 py-12"'),
  );
});

// ─── Structural guard ────────────────────────────────────────────────
// Cheap, direct check for Option A of issue #11: /embed never imports
// an island. Rendering can't observe hydration scripts (see the file
// header comment), so this is the one check that catches it directly.

Deno.test("embed routes never import an island", async () => {
  const files = [
    "./index.tsx",
    "./confirmed.tsx",
    "./book.ts",
  ];
  for (const file of files) {
    const source = await Deno.readTextFile(new URL(file, import.meta.url));
    assertFalse(
      source.includes("islands/"),
      `${file} must not import from islands/`,
    );
  }
});
