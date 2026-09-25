// Shared arktype validators for booking submission (POST /api/book and
// POST /embed/book).
//
// Field checks run in the same order the old Zod object declared its
// keys (name, email, notes, date, slot, guestTz, website) and stop at
// the first failing field/rule, mirroring `parsed.error.issues[0]` —
// the only issue `lib/book.ts` ever reads. Each per-field arktype
// `.pipe()` below both transforms (trim/lowercase/canonicalize) and
// validates in one pass, the same order Zod's `.trim().min().max()`
// chains ran in. Object-level arktype validation was deliberately not
// used here: composing all seven fields into a single `type({...})`
// does not preserve declaration order in the reported errors (arktype
// sorts by key internally), which would have changed which message a
// visitor sees first when several fields are invalid at once.

import { type } from "arktype";
import { Email } from "./email-pattern.ts";
import { isValidTimeZone } from "@spy4x/time/tz";
import { canonicalTimeZone, isCalendarDateTime } from "./clock.ts";

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

export interface BookingData {
  name: string;
  email: string;
  notes: string;
  date: string;
  slot: string;
  guestTz?: string;
  website: string;
}

export interface Issue {
  path: string[];
  message: string;
}

export type SafeParseResult =
  | { success: true; data: BookingData }
  | { success: false; error: { issues: Issue[] } };

function fail(field: string, message: string): SafeParseResult {
  return { success: false, error: { issues: [{ path: [field], message }] } };
}

function expectString(
  value: unknown,
): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value === "string") return { ok: true, value };
  if (value === undefined) return { ok: false, message: "Required" };
  const received = value === null ? "null" : typeof value;
  return { ok: false, message: `Expected string, received ${received}` };
}

const NameRule = type("string").pipe((s: string, ctx) => {
  const trimmed = s.trim();
  if (trimmed.length < 2) {
    return ctx.reject({ message: "Please enter your name." });
  }
  if (trimmed.length > 100) {
    return ctx.reject({
      message: "String must contain at most 100 character(s)",
    });
  }
  if (hasHeaderControlCharacters(trimmed)) {
    return ctx.reject({ message: "Name contains unsupported characters." });
  }
  return trimmed;
});

const EmailRule = type("string").pipe((s: string, ctx) => {
  const trimmed = s.trim().toLowerCase();
  const checked = Email(trimmed);
  if (checked instanceof type.errors) {
    return ctx.reject({ message: "Please enter a valid email." });
  }
  return trimmed;
});

const NotesRule = type("string").pipe((s: string, ctx) => {
  if (s.length > 500) {
    return ctx.reject({ message: "Notes must be 500 characters or less." });
  }
  if (hasTextControlCharacters(s)) {
    return ctx.reject({ message: "Notes contain unsupported characters." });
  }
  return s;
});

const DateRule = type("string").pipe((s: string, ctx) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return ctx.reject({ message: "Bad date format." });
  }
  // "2026-02-30" has the right shape but no such day (mig#57).
  if (!isCalendarDateTime(s)) {
    return ctx.reject({ message: "That date does not exist." });
  }
  return s;
});

const SlotRule = type("string").pipe((s: string, ctx) => {
  if (!/^\d{2}:\d{2}$/.test(s)) {
    return ctx.reject({ message: "Bad time format." });
  }
  // "24:00" or "10:60" has the right shape but no such time (mig#57).
  if (!isCalendarDateTime("2000-01-01", s)) {
    return ctx.reject({ message: "That time does not exist." });
  }
  return s;
});

const GuestTzRule = type("string").pipe((s: string, ctx) => {
  const trimmed = s.trim();
  if (trimmed.length > 100) {
    return ctx.reject({
      message: "String must contain at most 100 character(s)",
    });
  }
  if (!isValidTimeZone(trimmed)) {
    return ctx.reject({ message: "Bad timezone." });
  }
  return canonicalTimeZone(trimmed);
});

function runRule(
  rule: (input: string) => unknown,
  input: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const out = rule(input);
  if (out instanceof type.errors) return { ok: false, message: out.summary };
  return { ok: true, value: out as string };
}

export const BookingSchema = {
  safeParse(raw: Record<string, unknown>): SafeParseResult {
    const nameIn = expectString(raw.name);
    if (!nameIn.ok) return fail("name", nameIn.message);
    const name = runRule(NameRule, nameIn.value);
    if (!name.ok) return fail("name", name.message);

    const emailIn = expectString(raw.email);
    if (!emailIn.ok) return fail("email", emailIn.message);
    const email = runRule(EmailRule, emailIn.value);
    if (!email.ok) return fail("email", email.message);

    const notesIn = expectString(raw.notes);
    if (!notesIn.ok) return fail("notes", notesIn.message);
    const notes = runRule(NotesRule, notesIn.value);
    if (!notes.ok) return fail("notes", notes.message);

    const dateIn = expectString(raw.date);
    if (!dateIn.ok) return fail("date", dateIn.message);
    const date = runRule(DateRule, dateIn.value);
    if (!date.ok) return fail("date", date.message);

    const slotIn = expectString(raw.slot);
    if (!slotIn.ok) return fail("slot", slotIn.message);
    const slot = runRule(SlotRule, slotIn.value);
    if (!slot.ok) return fail("slot", slot.message);

    let guestTz: string | undefined;
    if (raw.guestTz !== undefined) {
      const guestTzIn = expectString(raw.guestTz);
      if (!guestTzIn.ok) return fail("guestTz", guestTzIn.message);
      const parsedGuestTz = runRule(GuestTzRule, guestTzIn.value);
      if (!parsedGuestTz.ok) return fail("guestTz", parsedGuestTz.message);
      guestTz = parsedGuestTz.value;
    }

    // Honeypot — must always be present, no other check.
    const websiteIn = expectString(raw.website);
    if (!websiteIn.ok) return fail("website", websiteIn.message);

    return {
      success: true,
      data: {
        name: name.value,
        email: email.value,
        notes: notes.value,
        date: date.value,
        slot: slot.value,
        guestTz,
        website: websiteIn.value,
      },
    };
  },
};
