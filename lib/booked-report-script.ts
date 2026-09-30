// Booking signal for /embed/confirmed (mig#95). A site that frames
// /embed can't see that its visitor booked a call, so the confirmed
// page tells the parent once per new booking:
// `{ type: "mig:booked" }` and nothing else.
//
// "Once": reopening or reloading the confirmed page must not count the
// same booking again. The page already has the booking's id, so the
// script remembers `mig:booked:<id>` in `sessionStorage` before it
// posts; the id never leaves the frame. If storage is blocked (some
// browsers do that for framed pages) the script posts anyway, because
// missing a booking is worse for the host than a rare repeat.
//
// `"*"` as targetOrigin, same reasoning as lib/height-report-script.ts:
// the message holds no id, name, email, time or token, so there is
// nothing a page on another origin could misuse, and the parent's exact
// origin isn't knowable from inside the iframe.
//
// The caller renders this script only for a booked, ok state; the
// cancelled and not-found states and the standalone /confirmed page
// never include it. It is built by a function and reads everything
// through the `window` parameter so lib/booked-report-script.test.ts
// can run the real source against a fake `window`, like the height
// script.

/** Inline script that posts `{ type: "mig:booked" }` to the parent
 *  once per `bookingId` per browser session. The id is only the
 *  storage key; it is never part of the message. */
export function bookedReportScript(bookingId: string): string {
  // `<` escaped so an id can never close the <script> element.
  const key = JSON.stringify(`mig:booked:${bookingId}`).replaceAll(
    "<",
    "\\u003c",
  );
  return `(function(){try{
if(window.parent===window)return;
var key=${key};
try{
if(window.sessionStorage.getItem(key))return;
window.sessionStorage.setItem(key,"1");
}catch(_s){}
window.parent.postMessage({type:"mig:booked"},"*");
}catch(_e){}})();`;
}
