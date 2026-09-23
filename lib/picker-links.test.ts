// mig#18 review follow-up: nothing tested that pushUrl (islands/
// BookingFlow.tsx) actually carries the visitor's tz into the address
// it pushes — a reviewer removed it once and every test stayed green.
// pickerPushAddress is the pure function pushUrl delegates to, so its
// tz behaviour can be pinned here without driving a real
// history.pushState.

import { assertEquals } from "@std/assert";
import { pickerHref, pickerPath, pickerPushAddress } from "./picker-links.ts";

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
