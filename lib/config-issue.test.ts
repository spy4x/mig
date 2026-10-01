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
      { name: "PORT", reason: "must be positive" },
      { name: "HOST_NAME", reason: "is missing" },
    ]),
    "  PORT: must be positive\n  HOST_NAME: is missing",
  );
});

Deno.test("formatConfigIssues: a name like an inherited Object member is not treated as fixed", () => {
  assertEquals(
    formatConfigIssues([{ name: "toString", reason: "has an invalid value" }]),
    "  toString: has an invalid value",
  );
});

Deno.test("formatConfigIssues: THEME, the URLs and HOST_EMAIL name what they accept", () => {
  const bad = (name: string) =>
    formatConfigIssues([{ name, reason: "has an invalid value" }]);
  assertEquals(bad("THEME"), '  THEME: must be "auto", "dark" or "light"');
  assertEquals(
    bad("HOST_EMAIL"),
    "  HOST_EMAIL: must be a valid email address",
  );
  for (const name of ["MEETING_URL", "PUBLIC_URL", "GITHUB_URL"]) {
    assertEquals(bad(name), `  ${name}: must be a URL string`);
  }
});
