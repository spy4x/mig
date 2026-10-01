import { assertEquals } from "@std/assert";
import { formatConfigIssues } from "./config-issue.ts";

Deno.test("formatConfigIssues: a fixed variable that is present but rejected gets its fixed message", () => {
  assertEquals(
    formatConfigIssues([{
      name: "HIDE_BRANDING",
      reason: "has an invalid value",
    }]),
    "  HIDE_BRANDING: must be true, false, 1, 0, yes, no or empty",
  );
});

Deno.test("formatConfigIssues: a fixed variable that is missing keeps the library's reason", () => {
  assertEquals(
    formatConfigIssues([{ name: "CANCEL_SECRET", reason: "is missing" }]),
    "  CANCEL_SECRET: is missing",
  );
});

Deno.test("formatConfigIssues: any other variable keeps the library's reason, one line each", () => {
  assertEquals(
    formatConfigIssues([
      { name: "MEETING_URL", reason: "must be a URL string" },
      { name: "HOST_NAME", reason: "is missing" },
    ]),
    "  MEETING_URL: must be a URL string\n  HOST_NAME: is missing",
  );
});

Deno.test("formatConfigIssues: a name like an inherited Object member is not treated as fixed", () => {
  assertEquals(
    formatConfigIssues([{ name: "toString", reason: "has an invalid value" }]),
    "  toString: has an invalid value",
  );
});
