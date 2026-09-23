// Progressive-enhancement timezone capture for the /embed booking
// form (issue #11, reviewer round 2). The standalone form hydrates
// BookingSubmit (islands/BookingSubmit.tsx), which reads
// Intl.DateTimeFormat().resolvedOptions().timeZone into a hidden
// guestTz field after mount. /embed never mounts an island (issue #11
// Option A), so it gets the same value the same way islands/theme.ts
// gets its theme: a tiny inline <script>, same style as
// lib/theme.ts:themeBootstrapScript — no nonce (Fresh adds one to
// every rendered <script> automatically), a try/catch so a hostile or
// ancient browser just leaves the field empty instead of throwing.
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
// zone. This script runs on every /embed page load that has no `tz`
// query param yet, detects the zone, and does a client-side
// `location.replace` to the same URL with `?tz=<zone>` appended
// (preserving every other query param — date, slot, month, err). The
// route only emits this script when `tz` is absent, so there's no
// loop: once the redirect lands, the URL has `tz` and the route skips
// the script on the next render. A try/catch means a hostile or
// ancient browser just leaves the URL alone and the page stays on the
// host-timezone fallback — same graceful degradation as
// guestTzCaptureScript.
//
// Chosen over a cookie (decision recorded in mig#15's PR): a query
// param keeps /embed stateless — no cookie banner question, no
// cross-origin cookie complications for an iframe embedded on a third
// -party site (some browsers block third-party cookies in an iframe
// by default; a query param has no such restriction) — at the cost of
// one extra client-side redirect on first load.
export function embedTzRedirectScript(): string {
  return `(function(){try{
var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
if(!tz)return;
var u=new URL(location.href);
u.searchParams.set("tz",tz);
location.replace(u.toString());
}catch(_e){}})();`;
}
