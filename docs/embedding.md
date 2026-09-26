# Embedding mig

Drop the booking flow into another page with an iframe:

```html
<iframe
  id="mig-embed"
  src="https://meet.example.com/embed?theme=dark"
  style="width:100%;max-width:36rem;border:0"
  title="Book a meeting"
></iframe>
```

Every step a visitor can reach from `/embed` — picking a date, picking a time,
the confirm form, the confirmation page at `/embed/confirmed` — stays under the
`/embed` path prefix. The only exceptions are the meeting link and the cancel
link on the confirmation page, which open in a new tab, because they point at
pages (`MEETING_URL`, `/cancel`) that live outside `/embed`. That means the host
embedding mig only needs to allow framing for `/embed`, not the whole site.

Concretely, on the host serving mig behind a reverse proxy, apply this to paths
starting with `/embed` only:

```
Content-Security-Policy: frame-ancestors https://your-site.example
```

That header is the actual requirement. Current browsers (Chromium, Firefox,
WebKit) follow `frame-ancestors` and ignore `X-Frame-Options` whenever both are
present on the same response — the CSP Level 2 spec calls for exactly that — so
an `X-Frame-Options: DENY` or `SAMEORIGIN` a reverse proxy sets globally can
stay; it won't block the frame as long as `frame-ancestors` is also there on
`/embed`. Only a browser old enough to lack CSP Level 2 support would still
honor `X-Frame-Options` and refuse the frame. The rest of the site (`/`,
`/confirmed`, `/cancel`) can keep denying framing entirely.

With JavaScript, choosing a day or a time inside the frame updates it in place,
without a page load, and the address it keeps stays under `/embed` too. The
script for that and the day's times (`/api/slots`) load from mig's own origin as
ordinary requests, which framing rules don't cover. Without JavaScript, every
step is a plain link or form post and booking still works.

## Theme

An iframe's `prefers-color-scheme` follows the _visitor's_ OS, not the page
embedding it — so `/embed` rendering light on a dark host site isn't a bug the
visitor's system settings can fix; the frame genuinely can't see the host page's
theme on its own. Tell it explicitly with `?theme=`:

- `?theme=dark` / `?theme=light` — force that theme inside the embed, regardless
  of the visitor's OS or anything stored in `localStorage`.
- `?theme=auto` (the default — same as omitting the param entirely) — the
  owner's `THEME` setting when it is `light` or `dark`; with `THEME=auto`, the
  stored preference (shared with the standalone site, since both live on the
  same origin), then `prefers-color-scheme`.

Any other value falls back to `auto` rather than erroring. Once forced, the
theme survives the whole flow — every link (date, time, change), the confirm
form's submission, and every redirect it can land on (success, validation error,
conflict, rate limit) — so `/embed/confirmed` renders in the same theme the
visitor picked a time in. An explicit `?theme=` never touches the standalone
site's `mig-theme` `localStorage` key: it only ever overrides what that key
would otherwise decide, for this one embed.

## Auto-resizing

Every page `/embed` itself renders — the date/time/confirm steps, a validation
error or rate limit on any of those, and every state of `/embed/confirmed`
(booked, cancelled, or a stale/invalid link) — posts its content height to the
parent on load and again whenever it changes, growing or shrinking to match:

```js
{ type: "mig:height", height: 612 } // height in CSS pixels
```

An unmatched path under `/embed` (a typo, or a link to a route that no longer
exists) falls through to mig's site-wide 404 page instead, which is not part of
the embed family — it renders the standalone site's header and footer — so it
carries no height script; a host framing only `/embed` shouldn't be able to
reach it in the first place.

Listen for it and size the iframe to match, so nothing is ever cut off at a
fixed height with an inner scrollbar:

```html
<script>
const iframe = document.getElementById("mig-embed");
window.addEventListener("message", (event) => {
  if (event.origin !== "https://meet.example.com") return;
  if (event.source !== iframe.contentWindow) return;
  if (event.data?.type !== "mig:height") return;
  iframe.style.height = `${event.data.height}px`;
});
</script>
```

Checking both `event.origin` (against mig's own origin) and `event.source`
(against the specific iframe's `contentWindow`) means a message from any other
frame or origin on the page is ignored, even one also named `"mig:height"`. The
message itself carries only a content height in CSS pixels — no booking details,
no visitor data — so mig posts it with target origin `"*"`; there's nothing in
it a different origin reading it could misuse.

## Timezone

`/embed` detects the visitor's timezone with a small inline script (no tracking,
nothing sent anywhere) on every page load, and carries it forward as a `?tz=`
query param on every link in the flow — so the slot list itself renders in the
visitor's zone, not just the confirmation email. The script re-checks the zone
on every load and redirects again only if it no longer matches the browser's own
zone (a link shared with someone else's `?tz=` already in it gets fixed on their
first visit). A zone already spelled the way the browser's own curated IANA list
has it is kept exactly as sent. Wrong casing is fixed two ways: first against
that curated list (`america/new_york` → `America/New_York`), then, for a name
the list omits entirely — most `Etc/*` zones, and a few modern names some
engines expose only through their legacy alias, such as `Asia/Ho_Chi_Minh` —
against the browser's own zone resolution, but only when that resolution is the
very same name in different casing (`etc/gmt+5` → `Etc/GMT+5`); when it would
resolve to a different, legacy name instead (`asia/ho_chi_minh` would resolve to
`Asia/Saigon`), the casing is left exactly as sent rather than renamed. An
`Etc/*` zone always renders as an offset, never a city, whatever its case. A
name with no slash (`Japan`, `EST5EDT`) is resolved to its full zone. None of
this ever rewrites a valid zone to a different (e.g. legacy) spelling, so a
browser that keeps reporting the same zone settles after one redirect. A query
param was chosen over a cookie so `/embed` stays stateless and works even where
an iframe's third-party cookies are blocked. Without JavaScript that param is
never set and the booking still goes through; the slot list, confirm step,
confirmation page and cancel page (on both `/embed` and the standalone site)
then show the host's time instead, labelled "Times are shown in the host's
timezone."
