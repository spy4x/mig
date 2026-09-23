import { assertEquals } from "@std/assert";
import { BookingSchema } from "./validators.ts";

// mig#3: BookingSchema moved from Zod to arktype. These cover the field
// checks that previously had no direct test — bad email, missing fields,
// bad date/time — and pin the exact user-facing message each one produces,
// since lib/book.ts's errRedirect shows `issues[0].message` to the visitor.

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

Deno.test("booking validator rejects a bad email with the visitor-facing message", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    email: "not-an-email",
  });

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(
      result.error.issues[0]?.message,
      "Please enter a valid email.",
    );
  }
});

Deno.test("booking validator trims and lowercases a valid email", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    email: "  Visitor@Example.COM  ",
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.email, "visitor@example.com");
  }
});

Deno.test("booking validator rejects a missing required field", () => {
  const { name: _name, ...withoutName } = validBooking;
  const result = BookingSchema.safeParse(withoutName);

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.error.issues[0]?.path, ["name"]);
  }
});

Deno.test("booking validator rejects a bad date with the visitor-facing message", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    date: "28-08-2026",
  });

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.error.issues[0]?.message, "Bad date format.");
  }
});

Deno.test("booking validator rejects a bad time with the visitor-facing message", () => {
  const result = BookingSchema.safeParse({ ...validBooking, slot: "10am" });

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.error.issues[0]?.message, "Bad time format.");
  }
});

Deno.test("booking validator rejects a too-short name with the visitor-facing message", () => {
  const result = BookingSchema.safeParse({ ...validBooking, name: "A" });

  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.error.issues[0]?.message, "Please enter your name.");
  }
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
