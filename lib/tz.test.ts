import { assertEquals } from "@std/assert";
import { formatInstantLong, formatInstantShort, zonedDateTime } from "./tz.ts";
import { meetingSummary } from "./ics.ts";
import type { Booking } from "./types.ts";

Deno.test("formats host-local booking instant in visitor timezone", () => {
  const instant = zonedDateTime("2026-08-28", "10:00", "Europe/Berlin");

  assertEquals(
    formatInstantShort(instant, "America/New_York"),
    "Fri 28 Aug 04:00",
  );
  assertEquals(
    formatInstantLong(instant, "America/New_York"),
    "Friday, 28 August 2026 at 04:00",
  );
});

Deno.test("visitor timezone conversion handles date boundaries", () => {
  const instant = zonedDateTime("2026-08-28", "01:00", "Europe/Berlin");

  assertEquals(
    formatInstantShort(instant, "America/Los_Angeles"),
    "Thu 27 Aug 16:00",
  );
});

Deno.test("meeting summary falls back from invalid stored visitor timezone", () => {
  const booking: Booking = {
    id: "01HXYZ",
    createdAt: "2026-08-25T16:42:00.000Z",
    date: "2026-08-28",
    time: "10:00",
    hostTz: "Europe/Berlin",
    guestTz: "Not/A_Timezone",
    guestName: "Visitor",
    guestEmail: "visitor@example.com",
    cancelTokenHash: "hash",
    status: "active",
  };

  assertEquals(meetingSummary(booking), "Friday, 28 August 2026 at 10:00");
});
