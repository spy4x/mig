import { assertEquals } from "@std/assert";
import { BookingSchema } from "./_validators.ts";

const validBooking = {
  name: "Visitor",
  email: "visitor@example.com",
  notes: "",
  date: "2026-08-28",
  slot: "10:00",
  website: "",
};

Deno.test("booking validator accepts valid visitor timezone", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    guestTz: "America/New_York",
  });

  assertEquals(result.success, true);
});

Deno.test("booking validator allows missing visitor timezone", () => {
  assertEquals(BookingSchema.safeParse(validBooking).success, true);
});

Deno.test("booking validator rejects unknown visitor timezone", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    guestTz: "Not/A_Timezone",
  });

  assertEquals(result.success, false);
});

Deno.test("booking validator rejects control characters", () => {
  assertEquals(
    BookingSchema.safeParse({ ...validBooking, name: "Visitor\nInjected" })
      .success,
    false,
  );
  assertEquals(
    BookingSchema.safeParse({ ...validBooking, notes: "Note\u0000Injected" })
      .success,
    false,
  );
  assertEquals(
    BookingSchema.safeParse({
      ...validBooking,
      notes: "First line\nSecond line",
    }).success,
    true,
  );
});
