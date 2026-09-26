// Height reporting for /embed (mig#44). A host that frames /embed
// wants the iframe to grow AND shrink to fit the flow's content
// instead of carrying a fixed height that clips the last step and
// scrolls inside the frame. There's no way for the parent page to
// read the iframe's content height itself (cross-origin, no
// exception) — the frame has to tell it, so this posts the marked
// content element's height to `window.parent` on load and again
// whenever it changes.
//
// mig#44 review: the first version measured
// `document.documentElement.scrollHeight` with `<html>`/`<body>` kept
// at `h-full min-h-dvh` (routes/_app.tsx) — `scrollHeight` on the
// *document* element is a high-water mark: it only ever grows within
// a session, because `min-h-dvh` ties the document's own box to the
// iframe's current (parent-set) viewport height, so shrinking the
// frame from that height back down just clips content instead of
// reporting the new, smaller height. Measured live, height only ever
// went up (653 → 653 → 802 → *stayed* 802 on a step back down whose
// actual content was 653, then 884 on a not-found page whose content
// was 308 — a 576px empty band). The fix is to stop asking the
// document how tall it is and instead measure the one element each
// page marks with `HEIGHT_ATTR` (`data-mig-height`) — the flow's own
// content wrapper, which every /embed page renders regardless of
// which state it's in (see routes/embed/index.tsx and
// routes/embed/confirmed.tsx) — via `getBoundingClientRect().height`,
// which reflects that element's actual rendered box, not the
// document's tallest-ever size.
//
// Same inline-script pattern as lib/guest-tz-script.ts and
// lib/theme.ts's themeScript: no build step, no dependency,
// a try/catch so a hostile or ancient browser just never posts instead
// of throwing. Everything goes through the
// `window` parameter passed in at the call site (the real `window`
// global in a browser) instead of bare identifiers, so the exact same
// script can be executed against a fake `window` in a Deno test — see
// lib/height-report-script.test.ts.
//
// `"*"` as postMessage's targetOrigin (mig#44 review): a content
// height in CSS pixels carries no user data, no booking details,
// nothing sensitive — there's nothing here a page on a different
// origin reading the message could misuse, so restricting the target
// origin would only add fragility (the parent's exact origin isn't
// knowable from inside the iframe) for no privacy benefit.

/** The attribute every /embed page's content wrapper carries so
 *  `heightReportScript` can find and measure it — see the file header
 *  comment for why the document itself (`scrollHeight`) is the wrong
 *  thing to measure. Exported so each route spreads the exact same
 *  attribute name onto its wrapper instead of a second, driftable
 *  string literal. */
export const HEIGHT_ATTR = "data-mig-height";

export function heightReportScript(): string {
  return `(function(){try{
if(window.parent===window)return;
var el=window.document.querySelector("[${HEIGHT_ATTR}]");
if(!el)return;
function send(){
var h=Math.ceil(el.getBoundingClientRect().height);
window.parent.postMessage({type:"mig:height",height:h},"*");
}
function start(){
send();
if(window.ResizeObserver){
new window.ResizeObserver(send).observe(el);
}else{
window.addEventListener("resize",send);
}
}
if(window.document.readyState==="complete"){start();}else{window.addEventListener("load",start);}
}catch(_e){}})();`;
}
