// Issue #33 — the hovered slot's date note ("Wed 23 Sep") measured
// 4.21:1 in the light theme, below the 4.5:1 floor for normal text.
// The note reused opacity-70 against the hover surface (brand-700 text
// on brand-50); opacity-80 clears 4.5:1 in all four states (light/dark
// x idle/hover) while staying visibly lighter than the slot time next
// to it — see the PR body for the four contrast numbers.

import { assert, assertEquals, assertFalse } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { TimeSlots } from "./TimeSlots.tsx";

Deno.test("renders a slot's date note at opacity-80, not opacity-70", () => {
  const html = renderToString(
    <TimeSlots
      date="2026-09-23"
      dateLabel="Wednesday, 23 September 2026"
      slots={[{
        time: "09:00",
        available: true,
        displayTime: "23:00, Auckland, UTC+13",
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
