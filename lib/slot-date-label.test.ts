import { assertEquals } from "@std/assert";
import { slotDateLabel } from "./slot-date-label.ts";

// mig#18 round 3: the standalone time card built its date from the
// slot's own instant, but nothing guarded it — building it from noon
// instead left every other test green. This pins the timezone
// boundary case: 09:00 in Ho Chi Minh on 2026-09-28 is still the
// evening before in New York.
Deno.test("slotDateLabel — 09:00 Ho Chi Minh slot lands on the previous day in New York", () => {
  assertEquals(
    slotDateLabel(
      "2026-09-28",
      "09:00",
      "Asia/Ho_Chi_Minh",
      "America/New_York",
    ),
    "Sunday, 27 September 2026",
  );
});

Deno.test("slotDateLabel — same day when host and display zones agree", () => {
  assertEquals(
    slotDateLabel("2026-08-28", "10:00", "Europe/Berlin", "Europe/Berlin"),
    "Friday, 28 August 2026",
  );
});
