import { assertEquals } from "@std/assert"
import { BookingSchema } from "./validators.ts"
import { TIME_ZONE_UNREADABLE } from "./field-messages.ts"
import { validateBooking } from "../islands/BookingSubmit.tsx"

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
}

Deno.test("booking validator accepts valid visitor timezone", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    guestTz: "America/New_York",
  })

  assertEquals(result.success, true)
})

Deno.test("booking validator allows missing visitor timezone", () => {
  assertEquals(BookingSchema.safeParse(validBooking).success, true)
})

Deno.test("booking validator rejects unknown visitor timezone in plain words", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    guestTz: "Not/A_Timezone",
  })

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(result.error.issues[0]?.message, TIME_ZONE_UNREADABLE)
  }
})

// mig#125: the submit button and the server word each name and email
// mistake the same way, so a visitor never sees two messages for one.
Deno.test("booking validator words each name and email mistake as the submit button does", () => {
  const cases: [field: "name" | "email", name: string, email: string][] = [
    ["name", "", "visitor@example.com"],
    ["name", " J ", "visitor@example.com"],
    ["name", "x".repeat(101), "visitor@example.com"],
    ["email", "Visitor", ""],
    ["email", "Visitor", "   "],
    ["email", "Visitor", "not-an-email"],
    ["email", "Visitor", "visitor@"],
  ]
  for (const [field, name, email] of cases) {
    const server = BookingSchema.safeParse({ ...validBooking, name, email })
    const client = validateBooking(name, email)
    assertEquals(server.success, false, `${field}: ${name} / ${email}`)
    if (!server.success) {
      assertEquals(server.error.issues[0]?.path, [field])
      assertEquals(
        server.error.issues[0]?.message,
        client[field],
        `${field}: ${name} / ${email}`,
      )
    }
  }
})

Deno.test("booking validator rejects a bad email with the visitor-facing message", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    email: "not-an-email",
  })

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(
      result.error.issues[0]?.message,
      "Enter an email address like name@example.com.",
    )
  }
})

// The email rule is `parseBareAddress` from @spy4x/email: the same
// address check it uses to send, plus a 254-character limit and a
// 64-character limit before the `@`.
// It replaced mig's copy of Zod 3's `.email()` pattern (mig#89); the
// cases below are the ones that pattern already decided, plus `%`,
// which Zod refused and the library accepts.
Deno.test("booking validator accepts an apostrophe in the local part", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    email: "o'brien@example.com",
  })

  assertEquals(result.success, true)
})

Deno.test("booking validator accepts a percent sign in the local part", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    email: "a%b@example.com",
  })

  assertEquals(result.success, true)
})

Deno.test("booking validator rejects an address longer than 254 characters", () => {
  const long = `${"a".repeat(60)}@${"b".repeat(60)}.${"c".repeat(60)}.${
    "d".repeat(60)
  }.${"e".repeat(20)}.com`
  assertEquals(long.length > 254, true)
  const result = BookingSchema.safeParse({ ...validBooking, email: long })
  assertEquals(result.success, false)
})

// mig#113: the part before the `@` reaches the guest's `To` header, the
// invitation and the owner's mail. Mail servers refuse one over 64
// characters, so the form does too.
Deno.test("booking validator rejects more than 64 characters before the @", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    email: `${"a".repeat(65)}@example.com`,
  })
  assertEquals(result.success, false)
})

Deno.test("booking validator accepts 64 characters before the @, plus-tag included", () => {
  const local = `someone+${"a".repeat(56)}`
  assertEquals(local.length, 64)
  const result = BookingSchema.safeParse({
    ...validBooking,
    email: `${local}@example.com`,
  })
  assertEquals(result.success, true)
})

for (
  const bad of [
    "a..b@example.com",
    ".a@example.com",
    "a.@example.com",
    "a@-example.com",
    "a@example..com",
  ]
) {
  Deno.test(`booking validator rejects ${bad}`, () => {
    const result = BookingSchema.safeParse({ ...validBooking, email: bad })
    assertEquals(result.success, false)
  })
}

Deno.test("booking validator trims and lowercases a valid email", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    email: "  Visitor@Example.COM  ",
  })

  assertEquals(result.success, true)
  if (result.success) {
    assertEquals(result.data.email, "visitor@example.com")
  }
})

Deno.test("booking validator rejects a missing required field", () => {
  const { name: _name, ...withoutName } = validBooking
  const result = BookingSchema.safeParse(withoutName)

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(result.error.issues[0]?.path, ["name"])
    assertEquals(result.error.issues[0]?.message, "Required")
  }
})

// mig#3 review round 2: `form.get()` in lib/book.ts returns `null` for a
// field that's simply absent from the submission — not `undefined` — so
// that's the shape BookingSchema actually receives in production, distinct
// from the `undefined` case above (a key genuinely missing from the
// object). Pinned against origin/main's Zod output for the same input.
Deno.test("booking validator: a null field (form.get()'s shape for a missing field) reports the Zod-parity message", () => {
  const result = BookingSchema.safeParse({ ...validBooking, name: null })

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(result.error.issues[0]?.path, ["name"])
    assertEquals(
      result.error.issues[0]?.message,
      "Expected string, received null",
    )
  }
})

Deno.test("booking validator: a payload with no website key at all is rejected (honeypot presence check)", () => {
  const { website: _website, ...withoutWebsite } = validBooking
  const result = BookingSchema.safeParse(withoutWebsite)

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(result.error.issues[0]?.path, ["website"])
    assertEquals(result.error.issues[0]?.message, "Required")
  }
})

// mig#3 review round 1: pins for the hand-written field-order
// orchestration in validators.ts — each one is a behaviour the old Zod
// object schema had that a naive rewrite could silently drop.
Deno.test("booking validator: name and email both invalid — name's message wins (declaration order)", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    name: "A",
    email: "not-an-email",
  })

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(result.error.issues[0]?.message, "Enter your name.")
  }
})

Deno.test("booking validator: name at exactly 100 chars is accepted, 101 is rejected in the submit button's words", () => {
  const at100 = BookingSchema.safeParse({
    ...validBooking,
    name: "B".repeat(100),
  })
  assertEquals(at100.success, true)

  const at101 = BookingSchema.safeParse({
    ...validBooking,
    name: "B".repeat(101),
  })
  assertEquals(at101.success, false)
  if (!at101.success) {
    assertEquals(
      at101.error.issues[0]?.message,
      "Enter a name of 100 characters or fewer.",
    )
  }
})

Deno.test("booking validator: notes at exactly 500 chars is accepted, 501 is rejected with a plain message", () => {
  const at500 = BookingSchema.safeParse({
    ...validBooking,
    notes: "N".repeat(500),
  })
  assertEquals(at500.success, true)

  const at501 = BookingSchema.safeParse({
    ...validBooking,
    notes: "N".repeat(501),
  })
  assertEquals(at501.success, false)
  if (!at501.success) {
    assertEquals(
      at501.error.issues[0]?.message,
      "Enter notes of 500 characters or fewer.",
    )
  }
})

Deno.test("booking validator: name is trimmed before the length check", () => {
  // 100 real characters padded with whitespace to 104 raw — accepted only
  // if trim() runs before max(100), same order Zod's .trim().max() chain
  // ran in.
  const result = BookingSchema.safeParse({
    ...validBooking,
    name: "  " + "B".repeat(100) + "  ",
  })

  assertEquals(result.success, true)
  if (result.success) {
    assertEquals(result.data.name, "B".repeat(100))
  }
})

Deno.test("booking validator: name is trimmed before the min-length check too", () => {
  // Raw length 3 (" A "), trimmed length 1 — must fail min(2) on the
  // trimmed value, the same order Zod's .trim().min() chain ran in.
  const result = BookingSchema.safeParse({ ...validBooking, name: " A " })

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(result.error.issues[0]?.message, "Enter your name.")
  }
})

Deno.test("booking validator: guestTz canonicalizes a legacy alias (Japan -> Asia/Tokyo)", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    guestTz: "Japan",
  })

  assertEquals(result.success, true)
  if (result.success) {
    assertEquals(result.data.guestTz, "Asia/Tokyo")
  }
})

Deno.test("booking validator says the time zone could not be read for a guestTz over 100 characters, never the raw limit", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    guestTz: "A".repeat(101),
  })

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(result.error.issues[0]?.message, TIME_ZONE_UNREADABLE)
  }
})

Deno.test("booking validator rejects a bad date with the visitor-facing message", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    date: "28-08-2026",
  })

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(result.error.issues[0]?.message, "Bad date format.")
  }
})

Deno.test("booking validator rejects a bad time with the visitor-facing message", () => {
  const result = BookingSchema.safeParse({ ...validBooking, slot: "10am" })

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(result.error.issues[0]?.message, "Bad time format.")
  }
})

Deno.test("booking validator rejects a too-short name with the visitor-facing message", () => {
  const result = BookingSchema.safeParse({ ...validBooking, name: "A" })

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(result.error.issues[0]?.message, "Enter your name.")
  }
})

// Pins the date regex's end anchor: without it, "2026-10-011" would match
// the first 10 characters and pass.
Deno.test("booking validator rejects a date with trailing extra digits", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    date: "2026-10-011",
  })

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(result.error.issues[0]?.message, "Bad date format.")
  }
})

// mig#57: @spy4x/time/tz's zonedDateTime throws on a date or time that
// is not on the calendar, where mig's own copy rolled it over, so the
// validator refuses one before it can get that far.
Deno.test("booking validator rejects a date that is not on the calendar", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    date: "2026-02-30",
  })

  assertEquals(result.success, false)
  if (!result.success) {
    assertEquals(result.error.issues[0]?.message, "That date does not exist.")
  }
})

Deno.test("booking validator rejects a time that is not on the clock", () => {
  for (const slot of ["24:00", "10:60"]) {
    const result = BookingSchema.safeParse({ ...validBooking, slot })

    assertEquals(result.success, false, slot)
    if (!result.success) {
      assertEquals(
        result.error.issues[0]?.message,
        "That time does not exist.",
      )
    }
  }
})

// Pins the name minimum length at 2, not 3.
Deno.test("booking validator: a two-character name is accepted", () => {
  const result = BookingSchema.safeParse({ ...validBooking, name: "Al" })

  assertEquals(result.success, true)
})

// Pins that guestTz is trimmed before being returned, not just before
// validation.
Deno.test("booking validator: guestTz is trimmed in the returned data", () => {
  const result = BookingSchema.safeParse({
    ...validBooking,
    guestTz: "  America/New_York  ",
  })

  assertEquals(result.success, true)
  if (result.success) {
    assertEquals(result.data.guestTz, "America/New_York")
  }
})

Deno.test("booking validator rejects control characters", () => {
  assertEquals(
    BookingSchema.safeParse({ ...validBooking, name: "Visitor\nInjected" })
      .success,
    false,
  )
  assertEquals(
    BookingSchema.safeParse({ ...validBooking, notes: "Note\u0000Injected" })
      .success,
    false,
  )
  assertEquals(
    BookingSchema.safeParse({
      ...validBooking,
      notes: "First line\nSecond line",
    }).success,
    true,
  )
})
