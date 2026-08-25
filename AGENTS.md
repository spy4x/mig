# AGENTS.md — mig

## Stack

- **Language:** TypeScript on Deno 2.x
- **Framework:** [Fresh 2](https://fresh.deno.dev/) (Preact + JSX, islands architecture)
- **Styling:** Tailwind CSS v4 (utility classes only — no custom CSS files)
- **Container:** Alpine-based, single binary via `deno compile`
- **CI:** Woodpecker (deno fmt + lint + check + test)
- **Storage:** JSON file (`./data/bookings.json`) + in-process async mutex
- **Email:** SMTP via `denomailer`
- **IDs:** ULID (Crockford base32, time-sortable)

## Invariants

- **One owner, no auth.** Single-tenant by design — owner is defined by
  env vars (`HOST_NAME`, `HOST_EMAIL`). No login, no admin UI, no DB.
- **Configuration is code.** All booking behaviour (working hours, blocked
  dates, slot duration, notice horizon, meeting URL, SMTP creds) lives
  in environment variables. Changing behaviour = restarting the container.
- **Stateless cancel tokens.** Cancellation links carry a SHA-256 HMAC of
  a random token; the raw token goes only in the email. No per-booking
  revoke — rotate `CANCEL_SECRET` to invalidate all.
- **No background jobs.** Everything is request/response. No cron, no
  reminder worker. v1 has no reminder emails.
- **Single instance only.** In-memory mutex serialises writes within the
  process. Multi-replica deployment is out of scope.

## Architecture

```
src/
├── main.ts                  — production entry (deno serve)
├── dev.ts                   — dev entry (vite)
├── deno.json                — Fresh imports, tasks, lint config
├── routes/
│   ├── _app.tsx             — HTML shell, theme bootstrap
│   ├── _404.tsx             — not found
│   ├── _500.tsx             — error
│   ├── index.tsx            — standalone booking page
│   ├── embed.tsx            — iframe variant
│   ├── book.tsx             — POST handler (form action)
│   ├── cancel.tsx           — GET form + POST action
│   └── api/slots.ts         — GET slots for a date (JSON)
├── islands/
│   ├── DatePicker.tsx       — client interactive
│   ├── SlotPicker.tsx
│   ├── BookingForm.tsx
│   └── ThemeToggle.tsx
├── lib/
│   ├── config.ts            — env parsing + Zod validation
│   ├── availability.ts      — weekly pattern + blocked-dates parser
│   ├── bookings.ts          — JSON store + AsyncMutex
│   ├── tokens.ts            — ULID + HMAC sign/verify
│   ├── email.ts             — SMTP via denomailer
│   ├── ics.ts               — ICS VCALENDAR generator
│   ├── ratelimit.ts         — in-memory per-IP sliding window
│   └── tz.ts                — IANA tz helpers
├── components/              — server-side Preact components (no hydration)
└── data/.gitkeep            — runtime mount point
```

## Conventions

- **Idiomatic TypeScript:** `deno fmt` clean, `deno lint` clean,
  `deno check` clean. Never commit with failures.
- **Indent:** 2 spaces, double quotes, no semis, 100-col.
- **Money/IDs as strings** — never numbers.
- **Functional over OO.** Small pure functions; class only when state
  genuinely needs encapsulation (`AsyncMutex`, `BookingsStore`).
- **Errors as data** — return `{ ok: true, value } | { ok: false, error }`
  for expected failure modes (validation, conflict). `throw` only for
  programmer errors and truly exceptional cases.
- **No third-party deps without justification.** Fresh, Preact, Tailwind,
  denomailer, zod are the budget. Anything else needs a comment.
- **Concurrency:** every mutation goes through `bookings.mutate()` which
  acquires the in-process mutex. Never read-then-write the JSON directly.

## Env vars

See `.env.example` for the full list. All vars validated at startup —
the process exits 1 if any required var is missing or malformed.

## Commands

```bash
deno task dev          # vite dev server, HMR
deno task build        # production build → _fresh/
deno task start        # serve the build
deno task check        # fmt + lint + type-check
deno task test         # unit tests
deno task compile      # deno compile → single binary
```

## CI

Woodpecker pipeline (`.woodpecker.yml`) on `denoland/deno:alpine`:
- `deno fmt --check`
- `deno lint`
- `deno check **/*.ts **/*.tsx`
- `deno test -A`
- `deno task build`

## Hard rules

- **NEVER commit plaintext secrets.** `.env` is gitignored.
- **NEVER hardcode real domains, emails, or hosts.** Templates only.
- **Single-process assumption.** No multi-instance; do not add
  distributed locks or external stores.
- **No background jobs in v1.** Reminders come later, if ever.
