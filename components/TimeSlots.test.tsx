// Issue #33 — the hovered slot's date note ("Wed 23 Sep") measured
// 4.21:1 in the light theme, below the 4.5:1 floor for normal text.
// The note reused opacity-70 against the hover surface (brand-700 text
// on brand-50); opacity-80 clears 4.5:1 in all four states (light/dark
// x idle/hover) while staying visibly lighter than the slot time next
// to it — see the PR body for the four contrast numbers.

import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { App } from "fresh";
import { TimeSlots } from "./TimeSlots.tsx";

Deno.test("renders a slot's date note at opacity-80, not opacity-70", () => {
  const html = renderToString(
    <TimeSlots
      date="2026-09-23"
      dateLabel="Wednesday, 23 September 2026"
      slots={[{
        time: "09:00",
        available: true,
        displayHHMM: "23:00",
        ariaZoneLabel: "Auckland, UTC+13",
        dateNote: "Wed 23 Sep",
      }]}
      onSelectSlot={() => {}}
    />,
  );

  assert(html.includes("Wed 23 Sep"), "expected the date note to render");
  assert(
    html.includes("opacity-80"),
    "expected the date note to use opacity-80 for 4.5:1 contrast on hover",
  );
  assertFalse(
    html.includes("opacity-70"),
    "opacity-70 measured 4.21:1 on hover in the light theme — below 4.5:1",
  );
});

Deno.test("renders no date note when the slot's day matches the picked date", () => {
  const html = renderToString(
    <TimeSlots
      date="2026-09-23"
      dateLabel="Wednesday, 23 September 2026"
      slots={[{ time: "09:00", available: true }]}
      onSelectSlot={() => {}}
    />,
  );

  assertEquals(html.includes("opacity-80"), false);
});

// ─── mig#48 review: accessible name includes the date note ──────────

Deno.test("a bookable slot's aria-label ends with its date note", () => {
  const html = renderToString(
    <TimeSlots
      date="2026-09-23"
      dateLabel="Wednesday, 23 September 2026"
      slots={[{
        time: "09:00",
        available: true,
        displayHHMM: "23:00",
        ariaZoneLabel: "Auckland, UTC+13",
        dateNote: "Wed 23 Sep",
      }]}
      onSelectSlot={() => {}}
    />,
  );

  assert(
    html.includes('aria-label="23:00, Auckland, UTC+13, Wed 23 Sep"'),
    "expected the accessible name to carry the full clock and the date note",
  );
});

Deno.test("the selected slot's full time is in visually hidden text, not just aria-label", () => {
  const html = renderToString(
    <TimeSlots
      date="2026-09-23"
      dateLabel="Wednesday, 23 September 2026"
      selectedSlot="09:00"
      slots={[{
        time: "09:00",
        available: true,
        displayHHMM: "23:00",
        ariaZoneLabel: "Auckland, UTC+13",
        dateNote: "Wed 23 Sep",
      }]}
    />,
  );

  // aria-label on a plain <span> (no interactive role) isn't reliably
  // exposed — the full time must be in the DOM as visible-but-hidden
  // text instead.
  assertFalse(
    html.includes("aria-label="),
    "expected no aria-label on the selected chip (unreliable on a <span>)",
  );
  assert(
    html.includes('class="sr-only"'),
    "expected a visually hidden element carrying the full time",
  );
  assert(
    /class="sr-only">23:00, Auckland, UTC\+13, Wed 23 Sep</.test(html),
    "expected the hidden text to carry the full clock and date note",
  );
  // The visible chip (bare "23:00" + the date note) must itself be
  // `aria-hidden`, or a screen reader would read both it and the
  // `sr-only` text above — announcing the time twice.
  assert(
    /aria-hidden="true"[^>]*>\s*<span>23:00<\/span>/.test(html),
    "expected the visible chip to be aria-hidden (not read twice alongside the sr-only text)",
  );
});

Deno.test("a booked (unavailable) slot's full time is in visually hidden text, not just aria-label", () => {
  const html = renderToString(
    <TimeSlots
      date="2026-09-23"
      dateLabel="Wednesday, 23 September 2026"
      slots={[{
        time: "09:00",
        available: false,
        displayHHMM: "23:00",
        ariaZoneLabel: "Auckland, UTC+13",
      }]}
      onSelectSlot={() => {}}
    />,
  );

  assertFalse(
    html.includes("aria-label="),
    "expected no aria-label on the booked chip (unreliable on a <span>)",
  );
  assert(
    /class="sr-only">23:00, Auckland, UTC\+13</.test(html),
    "expected the hidden text to carry the full clock",
  );
  // Same double-announcement guard as the selected chip: the visible
  // "23:00" must be aria-hidden, since the sr-only text above already
  // carries the full time.
  assert(
    /aria-hidden="true"[^>]*>\s*<span>23:00<\/span>/.test(html),
    "expected the visible chip to be aria-hidden (not read twice alongside the sr-only text)",
  );
});

// ─── mig#50: Fresh's active-link marking ─────────────────────────────

// Rendered through Fresh's own server renderer (`ctx.render`), not
// `renderToString`: the marking comes from a Preact hook Fresh installs
// for its render only, so a plain `renderToString` never shows it. Every
// slot link points at the page's own path, and Fresh marks such a link
// 'aria-current="true"' + `data-ancestor` unless it already has an
// `aria-current` of its own.
async function renderThroughFresh(path: string): Promise<string> {
  const basePath = path === "/" ? "" : path;
  const app = new App().get(path, (ctx) =>
    ctx.render(
      <TimeSlots
        date="2026-11-01"
        dateLabel="Sunday, 1 November 2026"
        slots={[
          { time: "17:00", available: true },
          { time: "18:00", available: true },
          { time: "19:00", available: true },
        ]}
        selectedSlot="18:00"
        basePath={basePath}
      />,
    ));
  const res = await app.handler()(
    new Request(`http://localhost${path}?date=2026-11-01`),
  );
  return await res.text();
}

for (const path of ["/", "/embed"]) {
  Deno.test(`mig#50: on ${path}, only the selected slot is marked current, never a slot link`, async () => {
    const html = await renderThroughFresh(path);
    const links = html.match(/<a [^>]*>/g) ?? [];
    assertEquals(links.length, 2, "expected the two unselected slots as links");
    for (const a of links) {
      assertFalse(a.includes('aria-current="true"'), a);
      assertFalse(a.includes('aria-current="page"'), a);
      assertFalse(a.includes("data-ancestor"), a);
      assertFalse(a.includes("data-current"), a);
    }
    const current = html.match(/<[a-z]+ [^>]*aria-current="true"[^>]*>/g) ?? [];
    assertEquals(current.length, 1, "expected exactly one current element");
    const [only] = current;
    assert(only?.startsWith("<span"), only);
    assert(only?.includes('title="Selected"'), only);
  });
}
