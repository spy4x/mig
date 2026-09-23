// Shared Zod validators for booking submission (POST /api/book and
// POST /embed/book).

import { z } from "zod";
import { canonicalTimeZone, isValidTimeZone } from "./tz.ts";

function hasHeaderControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 31 || code === 127;
  });
}

function hasTextControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return (code <= 31 && code !== 9 && code !== 10 && code !== 13) ||
      code === 127;
  });
}

export const BookingSchema = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(100).refine(
    (value) => !hasHeaderControlCharacters(value),
    "Name contains unsupported characters.",
  ),
  email: z.string().trim().toLowerCase().email("Please enter a valid email."),
  notes: z.string().max(500, "Notes must be 500 characters or less.").refine(
    (value) => !hasTextControlCharacters(value),
    "Notes contain unsupported characters.",
  ),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bad date format."),
  slot: z.string().regex(/^\d{2}:\d{2}$/, "Bad time format."),
  // Canonicalized once here (mig#15 review) so every stored booking's
  // guestTz is already IANA's canonical name and casing — "Japan",
  // "EST5EDT" and "america/new_york" all become the one real zone
  // name every downstream formatter expects, instead of needing every
  // reader to re-resolve a browser-reported alias.
  guestTz: z.string().trim().max(100).refine(isValidTimeZone, "Bad timezone.")
    .transform(canonicalTimeZone)
    .optional(),
  website: z.string(), // honeypot — must always be present
});
