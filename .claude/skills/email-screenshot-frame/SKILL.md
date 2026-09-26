---
name: email-screenshot-frame
description: 'Build the dark mail-client frame around mig''s confirmation email for the README picture (docs/screenshots/email-confirmation.png): toolbar, subject, sender with avatar, recipient, attachment chip, then the real email HTML. Load whenever asked to make, fix, restyle or regenerate the email screenshot or its frame.'
---

# Email screenshot frame

The README shows the guest's confirmation email inside a dark mail client. The
email body is always dark (`lib/email.ts` paints it `#0f172a`), so the frame
around it is dark too; a light frame around a dark email looks like a rendering
bug. The frame is a page the script builds itself: `emailPage()` in
`scripts/screenshots.ts`. There is no real mail client involved.

## Where the email comes from

`deno task build && deno task screenshots` makes one real booking through the
form. The app sends its mail to the script's in-process SMTP sink, and the
script reads the guest's message from it:

- `From` and `Subject` come from the raw message headers (`header()`), so the
  frame shows exactly what the app sent.
- `To` is the placeholder guest, `John Doe <john@example.com>`.
- The HTML is the message's `text/html` part (`htmlPart()`, quoted-printable
  decoded). It goes into an `<iframe srcdoc>` unchanged, so its own styles
  cannot leak into the frame, or the frame's into it.

Never paste a real email, address or domain into the frame. Placeholders only
(AGENTS.md).

## Layout, top to bottom

One 760 px card, centred, 40 px from the top, on a near-black page:

1. **Toolbar.** Back arrow, a thin divider, archive, delete and mark-unread on
   the left; reply, forward and a "more" ellipsis on the right. Each icon is a
   20 px stroked SVG path (`toolIcon()`), stroke width 1.8, round caps and
   joins, in the muted colour. They are decoration: no buttons, no labels, since
   nobody can click a picture.
2. **Subject.** 20 px, semibold, in the ink colour.
3. **Sender row.** A 40 px round avatar in mig's orange with the sender name's
   first letter in the page colour; next to it the sender name (semibold) with
   the address muted in angle brackets, and below that `to <recipient>`, muted.
   The sender name and address are split from the `From` header; a header
   without angle brackets shows whole as the name.
4. **Attachment chip.** A bordered pill with a file icon, `meeting.ics` and a
   muted "Calendar invite", because every confirmation carries the `.ics`
   invite.
5. **The email** in the iframe. A script sets the iframe's height to its
   content's `scrollHeight` on load and then sets `document.body.dataset.ready`;
   the script waits for that before the screenshot.

Toolbar and header are separated from each other and from the email by 1 px
lines. The card has a 1 px border and 12 px corners.

## Colours

Tailwind's slate scale, kept in `MAIL_FRAME` in the script:

| Role                      | Value     |
| ------------------------- | --------- |
| Page behind the card      | `#020617` |
| Card and header (= email) | `#0f172a` |
| Toolbar                   | `#0b1120` |
| Lines and borders         | `#1e293b` |
| Ink (subject, names)      | `#e2e8f0` |
| Muted (icons, addresses)  | `#94a3b8` |
| Avatar                    | `#f97316` |

The card uses the email's own background, so the frame and the email read as one
surface split by lines, not two boxes. If `lib/email.ts` changes its background,
change `pane` to match. The page sets
`<meta name="color-scheme" content="dark">`, and the script opens it in a `dark`
browser context.

## Taking the picture

- Viewport 1280x800 at device scale 2, `Europe/Berlin`, `en-US`, like every
  other picture.
- `shot()` blurs focus, parks the mouse in a corner and refuses to run in any
  other time zone.
- The email is shorter than the viewport, so the picture is clipped 40 px below
  the card's bottom.
- PNGs over 400 KB are quantised with ImageMagick when it is installed.

## Checking it

Open `docs/screenshots/email-confirmation.png` and look: no light pixels
anywhere in the frame; the subject, sender, recipient and chip are legible
against the dark card; the email body and the card share one background with
only a line between them; the card ends with 40 px of page below it.
