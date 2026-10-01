// Startup error lines for mig's environment. @spy4x/server's `loadConfig`
// reports each failing variable as `{ name, reason }` with no value in it.
// Its reason for a custom check is only "has an invalid value", and an
// operator needs to know what is accepted, so these variables keep a
// message chosen by hand here (mig#42). A fixed string is never built from
// the value, so it can list accepted values without risking a leak.
import type { ConfigIssue } from "@spy4x/server/config";

// Looked up with `Object.hasOwn`, not `in`: `name` comes from the
// library's cross-field label or a variable name, and `in` would walk the
// prototype chain for a name like `"toString"`.
const FIXED_MESSAGES: Record<string, string> = {
  HIDE_BRANDING: "must be true, false, 1, 0, yes, no or empty",
  TRUSTED_PROXY_HEADER:
    "must be cf-connecting-ip, x-forwarded-for, x-real-ip or empty",
  CANCEL_SECRET:
    "must be at least 32 printable ASCII characters, not counting spaces at either end",
  SMTP_FROM: "must be an address or Name <address>, with no control characters",
};

/** Renders the issues of a `ConfigError` as startup-log lines, one per
 *  variable, naming the variable and never its value. A variable that is
 *  missing keeps the library's "is missing"; one listed in
 *  `FIXED_MESSAGES` that is present but rejected gets its fixed message. */
export function formatConfigIssues(issues: readonly ConfigIssue[]): string {
  return issues
    .map(({ name, reason }) =>
      reason !== "is missing" && Object.hasOwn(FIXED_MESSAGES, name)
        ? `  ${name}: ${FIXED_MESSAGES[name]}`
        : `  ${name}: ${reason}`
    )
    .join("\n");
}
