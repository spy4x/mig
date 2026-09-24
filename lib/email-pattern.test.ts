import { assertEquals } from "@std/assert";
import { EMAIL_PATTERN } from "./email-pattern.ts";

// mig#3 review round 2: pin the "byte for byte" claim in
// lib/email-pattern.ts's own comment. This is zod 3.25.76's
// `v3/types.js:384` `emailRegex` source text, copied verbatim (verified
// against `node_modules/zod` in a throwaway `origin/main` worktree,
// including its redundant `\-`/`\.` escapes) — not the shortest regex
// that matches the same strings, the actual source text zod shipped. If
// EMAIL_PATTERN's source ever drifts from this literal, even by an
// equivalent-but-differently-escaped character, this goes red.
const ZOD_3_25_76_EMAIL_REGEX_SOURCE =
  "^(?!\\.)(?!.*\\.\\.)([A-Z0-9_'+\\-\\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\\-]*\\.)+[A-Z]{2,}$";

Deno.test("EMAIL_PATTERN's source is byte-for-byte zod 3.25.76's emailRegex", () => {
  assertEquals(EMAIL_PATTERN.source, ZOD_3_25_76_EMAIL_REGEX_SOURCE);
  assertEquals(EMAIL_PATTERN.flags, "i");
});
