import { assertEquals } from "@std/assert"
import { validateBooking } from "./BookingSubmit.tsx"

Deno.test("validateBooking names each empty field, so each error sits under its own field", () => {
  assertEquals(validateBooking("", ""), {
    name: "Enter your name.",
    email: "Enter your email.",
  })
  assertEquals(validateBooking("  J ", "not-an-address"), {
    name: "Enter your name.",
    email: "Enter an email address like name@example.com.",
  })
})

Deno.test("validateBooking finds nothing wrong with a full name and an address", () => {
  assertEquals(validateBooking("Jane Doe", "jane@example.com"), {})
})

Deno.test("validateBooking refuses a name over 100 characters", () => {
  assertEquals(validateBooking("x".repeat(101), "jane@example.com"), {
    name: "Enter a name of 100 characters or fewer.",
  })
})
