// mig#18 review follow-up: nothing tested that pushUrl (islands/
// BookingFlow.tsx) actually carries the visitor's tz into the address
// it pushes — a reviewer removed it once and every test stayed green.
// pickerPushAddress is the pure function pushUrl delegates to, and
// pickerLinks is what BookingFlow.tsx actually calls (it binds one tz
// to both the children's `<a href>`s and pushUrl's address, so a
// mutation has nowhere smaller to live than the `pickerLinks(linkTz)`
// call itself) — both are unit-testable here without driving a real
// history.pushState.
//
// What these tests do NOT prove: that pushUrl still calls
// `links.pushAddress` at all, rather than building its own
// URLSearchParams by hand. That's invisible to a unit test of
// picker-links.ts (it never sees islands/BookingFlow.tsx's source)
// and to a server-rendered test of routes/index.tsx (a server render
// never calls pushUrl — its handlers only exist after client-side
// hydration). Catching that form of the mutation needs a real browser
// driving a click and reading location.search afterward; this repo
// has no such test today.

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
