// mig#15 review: the tz-redirect script's decision (redirect exactly
// when the URL's tz param doesn't match the browser's detected zone)
// is pure and testable via shouldRedirectTz; the actual inline script
// has no build step and can't be executed in a Deno test, so its
// guestTz-capture sibling is pinned by asserting its source contains
// the fill-only-when-empty guard.

import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  embedTzRedirectScript,
  guestTzCaptureScript,
  shouldRedirectTz,
} from "./guest-tz-script.ts";

Deno.test("shouldRedirectTz: redirects when the param is missing", () => {
  assertEquals(shouldRedirectTz(null, "America/New_York"), true);
});

Deno.test("shouldRedirectTz: redirects when a shared link's zone doesn't match the visitor's", () => {
  // The exact regression this fixes: /embed?tz=Europe/Berlin opened by
  // a New York visitor used to never re-fire the redirect because the
  // old check only looked at "is tz present at all", not "does it
  // match". Comparing values directly corrects it in one redirect.
  assertEquals(shouldRedirectTz("Europe/Berlin", "America/New_York"), true);
});

Deno.test("shouldRedirectTz: never redirects when the param already matches — no loop", () => {
  assertEquals(
    shouldRedirectTz("America/New_York", "America/New_York"),
    false,
  );
});

Deno.test("shouldRedirectTz: never redirects for a modern zone name the browser itself reports", () => {
  // mig#15 round 2: canonicalizing "Asia/Kolkata" to "Asia/Calcutta"
  // server-side (round 1's bug) meant a browser that itself detects
  // and reports the modern name would never see its own value
  // reflected back in the URL, redirecting on every single load. Now
  // that canonicalization leaves modern names alone, the URL and the
  // detected zone actually agree once the first redirect lands.
  assertEquals(shouldRedirectTz("Asia/Kolkata", "Asia/Kolkata"), false);
});

Deno.test("embedTzRedirectScript: mirrors shouldRedirectTz's comparison", () => {
  const script = embedTzRedirectScript();
  assert(
    script.includes('u.searchParams.get("tz")===tz'),
    "expected the script to compare the current param against the detected zone",
  );
});

Deno.test("guestTzCaptureScript: only fills an empty field (mig#15 review)", () => {
  // Regression guard: this used to unconditionally overwrite a value
  // BookingForm had already pre-filled from the tz query param with a
  // freshly-detected one, which could submit a booking in a different
  // zone than the page had just shown the visitor.
  const script = guestTzCaptureScript("my-id");
  assert(
    script.includes("!el.value"),
    "expected the fill-only-when-empty guard",
  );
  assertFalse(
    /if\(el&&tz\)el\.value=tz/.test(script),
    "must not unconditionally overwrite an existing value",
  );
});
