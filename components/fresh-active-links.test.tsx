// mig#50 — Fresh's server renderer marks every `<a>` that points at the
// page's own path with `aria-current` ("page" for the same query string
// or none, "true" otherwise) plus `data-current` / `data-ancestor`,
// unless the link already sets `aria-current` itself. Every picker link
// on `/` and `/embed` points back at the same page with a different
// query string, so a screen reader announced them all as current. These
// tests render through Fresh's own `ctx.render` — a plain
// `renderToString` never runs Fresh's hook — and check that no link
// carries Fresh's marking. TimeSlots.test.tsx covers the slot links.

import { assertEquals, assertFalse } from "@std/assert";
import { App } from "fresh";
import type { VNode } from "preact";
import { Calendar } from "./Calendar.tsx";
import { DateCard } from "./DateCard.tsx";
import { TimeCard } from "./TimeCard.tsx";

async function renderThroughFresh(url: string, node: VNode): Promise<string> {
  const path = new URL(url).pathname;
  const app = new App().get(path, (ctx) => ctx.render(node));
  const res = await app.handler()(new Request(url));
  return await res.text();
}

// Every `<a>` opening tag's `aria-current` value, after checking that
// Fresh left none of its own marking on it.
function linkCurrents(html: string): string[] {
  const links = html.match(/<a [^>]*>/g) ?? [];
  for (const a of links) {
    assertFalse(a.includes("data-ancestor"), a);
    assertFalse(a.includes("data-current"), a);
  }
  return links.map((a) => a.match(/aria-current="([^"]*)"/)?.[1] ?? "none");
}

for (const base of ["", "/embed"]) {
  const path = base || "/";

  Deno.test(`mig#50: on ${path}, only the selected calendar day is current — never another day or a month link`, async () => {
    const html = await renderThroughFresh(
      `http://localhost${path}?date=2026-11-03`,
      <Calendar
        monthAnchor="2026-11-01"
        minDate="2026-11-02"
        maxDate="2026-11-04"
        slotsByDate={{ "2026-11-02": 3, "2026-11-03": 3, "2026-11-04": 3 }}
        selectedDate="2026-11-03"
        hostTz="Europe/Berlin"
        basePath={base}
      />,
    );
    const currents = linkCurrents(html);
    // Previous month, next month, and the three bookable days.
    assertEquals(currents.length, 5, html);
    assertEquals(currents.filter((c) => c === "date").length, 1);
    assertEquals(currents.filter((c) => c !== "date"), [
      "false",
      "false",
      "false",
      "false",
    ]);
  });

  Deno.test(`mig#50: on ${path}, the date and time cards' Change links are not current`, async () => {
    const html = await renderThroughFresh(
      `http://localhost${path}?date=2026-11-03&slot=09%3A00`,
      <div>
        <DateCard
          date="2026-11-03"
          dateLabel="Tuesday, 3 November 2026"
          basePath={base}
        />
        <TimeCard
          date="2026-11-03"
          slot="09:00"
          dateLabel="Tuesday, 3 November 2026"
          basePath={base}
        />
      </div>,
    );
    assertEquals(linkCurrents(html), ["false", "false"]);
  });
}
