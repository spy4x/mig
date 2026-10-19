# mig design brief

## Who it is for

- The invitee: a stranger or client who got a link and wants to book a call with
  one person in under a minute, often on a phone, often once. They never sign in
  and owe mig nothing.
- The host: one person who self-hosts mig and puts the link in an email
  signature or embeds it on their site. They judge mig by how it makes them
  look.

## Its job

Let an invitee pick a day, pick a time and leave their name and email, and leave
sure it worked: who, when, where, and that an invite is in their inbox. One
primary action per step: pick, pick, confirm.

## Kind of page

A single-page tool in the house design language: a top bar with the mig mark and
the theme toggle, then one content column. No app shell, no rail. `/embed` drops
the bar and the footer.

## Voice

Plain, warm, short. It speaks for the host, not for mig ("Book a meeting with
Jane Doe"). Dates and times in full, in the invitee's time zone, always with the
zone named. Errors say what happened and what to do next. No exclamation marks,
no "Oops", no urgency.

## Brand

Teal, `oklch(0.5 0.09 178)` (`#097463`), on the primary button, the selected
day, the brand mark and the favicon only. Neutrals, type (Geist), radius, motion
and components are the house ones. Dark mode is the library's ink palette.

## Quality bar

- Cal.com: a public booking page that is one obvious flow, open source and still
  crafted.
- Linear: restraint, one accent, near-black dark mode, every state finished.
- Stripe Checkout: a form a stranger trusts at first sight; errors at the field,
  in plain words.
