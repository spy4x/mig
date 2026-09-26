// Progressive-enhancement timezone capture for the /embed booking
// form (issue #11, reviewer round 2). The standalone form hydrates
// BookingSubmit (islands/BookingSubmit.tsx), which reads
// Intl.DateTimeFormat().resolvedOptions().timeZone into a hidden
// guestTz field after mount. /embed keeps its own field (see
// components/BookingForm.tsx), pre-filled from its `tz` param; when
// that is empty, it gets the value the same way the theme bootstrap
// does: a tiny inline <script>, same style as
// lib/theme.ts:themeScript — no nonce (Fresh adds one to
// every rendered <script> automatically), a try/catch so a hostile or
// ancient browser just leaves the field empty instead of throwing.
// Once BookingFlow is hydrated on /embed (mig#85), a form it renders
// client-side runs no inline script, but it pre-fills the field with
// the zone it detected itself, so the script isn't needed there.
//
// Without JavaScript the field stays empty and lib/book.ts already
// treats guestTz as optional, falling back to the host's timezone —
// the flow still completes either way.
//
// mig#15: only fills the field when it's still empty. BookingForm now
// pre-fills it from the already-known `tz` query param when one
// exists — the same zone every time on screen up to this point was
// rendered in (routes/embed/index.tsx). Overwriting that
// unconditionally with a freshly-detected zone would let the
// submitted booking (and its confirmation email) end up in a
// different zone than what the visitor just confirmed on screen —
// e.g. a shared /embed link with someone else's `tz` still in the
// URL, or a device zone change mid-flow. The empty-field case is the
// genuine no-JS-until-now fallback this script originally covered.
export function guestTzCaptureScript(inputId: string): string {
  return `(function(){try{
var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
var el=document.getElementById(${JSON.stringify(inputId)});
if(el&&tz&&!el.value)el.value=tz;
}catch(_e){}})();`;
}

// /embed's timezone-before-first-paint fix (mig#15). guestTzCaptureScript
// above only fills the hidden form field once the visitor reaches the
// confirm step — too late to render the slot list itself in their
// zone. This script runs on *every* /embed page load, detects the
// zone, and does a client-side `location.replace` to the same URL
// with `?tz=<zone>` set (preserving every other query param — date,
// slot, month, err) whenever the detected zone doesn't already match
// the URL's current `tz` param. A try/catch means a hostile or
// ancient browser just leaves the URL alone and the page stays on the
// host-timezone fallback — same graceful degradation as
// guestTzCaptureScript.
//
// mig#15 review: this used to run only when `tz` was absent from the
// URL, so a link shared with someone else's zone already baked in
// (`/embed?tz=Europe/Berlin`) showed Berlin time to whoever opened it,
// forever — the redirect never re-fired to correct it. Comparing
// against the *current* param instead of just its presence fixes
// that: a mismatch (including "absent", `null !== "America/New_York"`)
// triggers exactly one replace; a match — including the very next load
// after that replace — triggers none, so there's still no loop.
// shouldRedirectTz below is the same decision as a plain, testable
// function; keep the two in sync if either changes.
//
// Chosen over a cookie (decision recorded in mig#15's PR): a query
// param keeps /embed stateless — no cookie banner question, no
// cross-origin cookie complications for an iframe embedded on a third
// -party site (some browsers block third-party cookies in an iframe
// by default; a query param has no such restriction) — at the cost of
// one extra client-side redirect whenever the zone is missing or wrong.
export function embedTzRedirectScript(): string {
  return `(function(){try{
var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
if(!tz)return;
var u=new URL(location.href);
if(u.searchParams.get("tz")===tz)return;
u.searchParams.set("tz",tz);
location.replace(u.toString());
}catch(_e){}})();`;
}

// Pure decision logic behind embedTzRedirectScript's `location.replace`
// (mig#15 review) — factored out so it's unit-testable without a DOM
// or a real Intl detection: redirect exactly when the URL's current
// `tz` param (or its absence, `null`) doesn't match the browser's
// freshly detected zone. Must stay logically identical to the
// `u.searchParams.get("tz")===tz` check inside the script string
// above — there's no way to share the actual code between a plain
// string (the script, which runs with no build step) and this module
// (which does), so this is the same decision restated, not called.
export function shouldRedirectTz(
  currentParam: string | null,
  detectedZone: string,
): boolean {
  return currentParam !== detectedZone;
}
