// pickerPushAddress is the pure function BookingFlow.tsx's pushUrl
// delegates to (via pickerLinks), and pickerLinks is what pushUrl and
// the picker's children actually call — both are unit-testable here
// without driving a real history.pushState.
//
// What these tests do NOT prove: that pushUrl itself still calls
// `links.pushAddress`, rather than building its own URLSearchParams
// by hand, or calling `pickerLinks(null).pushAddress(next)`, or
// `pickerPushAddress(next, null)` directly. Every one of those drops
// `tz` from the address pushUrl writes, and none of them is visible
// to a unit test of picker-links.ts (it never sees
// islands/BookingFlow.tsx's source) or to a server-rendered test of
// routes/index.tsx (a server render never calls pushUrl — its
// handlers only exist after client-side hydration). Catching any of
// those forms needs a real browser driving a click and reading
// location.search afterward; this repo has no such test today. What
// *is* caught: an edit to the `pickerLinks(linkTz)` binding itself in
// BookingFlow.tsx, because the same binding also feeds the `tz` on
// every `<a href>` routes/index.test.tsx checks.

import { assertEquals } from "@std/assert";
import {
  pickerHref,
  pickerLinks,
  pickerPath,
  pickerPushAddress,
} from "./picker-links.ts";

Deno.test("pickerPath: standalone basePath resolves to /", () => {
  assertEquals(pickerPath(""), "/");
});

Deno.test("pickerPath: /embed basePath resolves to itself", () => {
  assertEquals(pickerPath("/embed"), "/embed");
});

Deno.test("pickerHref: carries tz when given a zone", () => {
  assertEquals(
    pickerHref("/embed", { date: "2026-09-21" }, "America/New_York"),
    "/embed?date=2026-09-21&tz=America%2FNew_York",
  );
});

Deno.test("pickerHref: omits tz when none is known", () => {
  assertEquals(
    pickerHref("/embed", { date: "2026-09-21" }, null),
    "/embed?date=2026-09-21",
  );
});

Deno.test("pickerPushAddress: an address built for a visitor with a known zone carries tz", () => {
  assertEquals(
    pickerPushAddress(
      { date: "2026-09-28", slot: "09:00" },
      "America/New_York",
    ),
    "/?date=2026-09-28&slot=09%3A00&tz=America%2FNew_York",
  );
});

Deno.test("pickerPushAddress: an address built for a visitor with no zone carries none", () => {
  assertEquals(
    pickerPushAddress({ date: "2026-09-28", slot: "09:00" }, null),
    "/?date=2026-09-28&slot=09%3A00",
  );
});

Deno.test("pickerPushAddress: a bare picker with no date, slot, month or tz is just /", () => {
  assertEquals(pickerPushAddress({ date: null }, null), "/");
});

Deno.test("pickerPushAddress: month carries through alongside tz", () => {
  assertEquals(
    pickerPushAddress({ date: null, month: "2026-09-01" }, "Europe/Berlin"),
    "/?month=2026-09-01&tz=Europe%2FBerlin",
  );
});

Deno.test("pickerLinks: exposes the bound tz for the children's <a href>s", () => {
  assertEquals(pickerLinks("America/New_York").tz, "America/New_York");
  assertEquals(pickerLinks(null).tz, null);
});

Deno.test("pickerLinks: pushAddress carries the bound tz", () => {
  assertEquals(
    pickerLinks("America/New_York").pushAddress({
      date: "2026-09-28",
      slot: "09:00",
    }),
    "/?date=2026-09-28&slot=09%3A00&tz=America%2FNew_York",
  );
});

Deno.test("pickerLinks: pushAddress carries no tz when none is bound", () => {
  assertEquals(
    pickerLinks(null).pushAddress({ date: "2026-09-28", slot: "09:00" }),
    "/?date=2026-09-28&slot=09%3A00",
  );
});
