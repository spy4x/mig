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

export function guestTzCaptureScript(inputId: string): string {
  return `(function(){try{
var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
var el=document.getElementById(${JSON.stringify(inputId)});
if(el&&tz)el.value=tz;
}catch(_e){}})();`;
}
