# mig ⏱

[![Docker](https://img.shields.io/badge/docker-ghcr.io%2Fspy4x%2Fmig-blue)](https://github.com/spy4x/mig/pkgs/container/mig)
[![Deno](https://img.shields.io/badge/deno-2.x-black?logo=deno)](https://deno.land)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![GitHub](https://img.shields.io/badge/github-spy4x%2Fmig-181717?logo=github)](https://github.com/spy4x/mig)

**mig** (миг — Russian for "moment") is a tiny self-hosted meeting scheduler.
One owner, one URL, one feature: book a time slot.

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│ Visitor  │───▶│   mig    │───▶│  Owner   │
│ (anyone) │    │ (single) │    │  (you)   │
└──────────┘    └──────────┘    └──────────┘
                     │
                     ▼
              ┌─────────────┐
              │ JSON file + │
              │ SMTP + ICS  │
              └─────────────┘
```

## Why mig?

Calendly alternatives are heavyweight (cal.com = Next.js + Postgres + Redis,
CloudMeet = Cloudflare + D1 + OAuth). Mig is a single Deno binary that reads its
config from env vars and stores bookings in a JSON file. No DB, no OAuth, no
admin UI.

**Use it if:**

- You want to put a "book a meeting with me" link on your personal site
- You don't need round-robin, payments, multiple event types, or teams
- You enjoy owning your data in a file you can `cat`

**Don't use it if:**

- You need a team scheduler, payments, or calendar sync
- You need to scale to thousands of bookings per day

## Features

- **One owner, one URL.** No accounts, no login. Owner defined via `HOST_NAME` +
  `HOST_EMAIL` env vars.
- **IaaC.** Working hours, blocked dates, slot duration, meeting URL, SMTP
  credentials — all env vars. No admin UI to configure.
- **JSON storage + atomic write.** Bookings live in `data/bookings.json`,
  written via temp-file-then-rename. Single process; in-memory mutex serialises
  writes.
- **Static meeting link.** One `MEETING_URL` (Google Meet, Miratalk, Whereby,
  etc.) embedded in every confirmation email.
- **ICS attachment.** Every confirmation includes a `.ics` file so the guest can
  add the meeting to their calendar in one click.
- **Cancellation by link.** Both owner and guest get a cancellable link in their
  email. SHA-256 HMAC of a random token; stateless.
- **Timezone-aware.** Host's TZ from env. Guest's TZ auto-detected in the
  browser and rendered in emails alongside host time.
- **Iframe-ready.** `/embed` route strips chrome for use inside another page.
- **Dark + light theme.** Tailwind v4, follows OS preference, toggle persists in
  localStorage.
- **Modern stack.** Fresh 2 (Preact + JSX), Tailwind v4, single binary via
  `deno compile`.

## Quick start

### Docker

```bash
docker run -d --name mig \
  -p 8080:8080 \
  -v ./data:/app/data \
  -e HOST_NAME="Jane Doe" \
  -e HOST_EMAIL="jane@example.com" \
  -e HOST_TZ="Europe/Berlin" \
  -e MEETING_URL="https://meet.google.com/abc-defg-hij" \
  -e WEEKLY_AVAILABILITY="MON-FRI 09:00-17:00" \
  -e SLOT_DURATION_MIN=30 \
  -e MIN_NOTICE_HOURS=6 \
  -e SMTP_HOST=smtp.example.com \
  -e SMTP_PORT=587 \
  -e SMTP_USER=jane@example.com \
  -e SMTP_PASS=<REDACTED:SMTP_PASS> \
  -e SMTP_FROM="Bookings <book@example.com>" \
  -e CANCEL_SECRET=$(openssl rand -base64 32) \
  -e PUBLIC_URL=https://meet.example.com \
  ghcr.io/spy4x/mig:latest
```

### Docker Compose

```yaml
services:
  mig:
    image: ghcr.io/spy4x/mig:latest
    container_name: mig
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
    environment:
      HOST_NAME: "Jane Doe"
      HOST_EMAIL: "jane@example.com"
      HOST_TZ: "Europe/Berlin"
      MEETING_URL: "https://meet.google.com/abc-defg-hij"
      WEEKLY_AVAILABILITY: "MON-FRI 09:00-17:00"
      SLOT_DURATION_MIN: "30"
      MIN_NOTICE_HOURS: "6"
      SMTP_HOST: "smtp.example.com"
      SMTP_PORT: "587"
      SMTP_USER: "jane@example.com"
      SMTP_PASS: "<REDACTED:SMTP_PASS>"
      SMTP_FROM: "Bookings <book@example.com>"
      CANCEL_SECRET: "<REDACTED:CANCEL_SECRET>"
      PUBLIC_URL: "https://meet.example.com"
```

See `.env.example` for the full list of env vars.

## Configuration

| Env var                | Required | Default | Description                                                                    |
| ---------------------- | -------- | ------- | ------------------------------------------------------------------------------ |
| `HOST_NAME`            | yes      | —       | Owner's display name                                                           |
| `HOST_EMAIL`           | yes      | —       | Owner's email (receives booking + cancel notifications)                        |
| `HOST_TZ`              | yes      | —       | IANA timezone, e.g. `Europe/Berlin`                                            |
| `MEETING_URL`          | yes      | —       | Static meeting URL embedded in every confirmation                              |
| `WEEKLY_AVAILABILITY`  | yes      | —       | Comma-separated `DAY HH:MM-HH:MM` list, e.g. `MON-FRI 09:00-17:00` (see below) |
| `SLOT_DURATION_MIN`    | yes      | —       | Slot length in minutes (e.g. 30)                                               |
| `CANCEL_SECRET`        | yes      | —       | Random 32+ byte secret for HMAC sign/verify                                    |
| `SMTP_HOST`            | yes      | —       | SMTP server hostname                                                           |
| `SMTP_PORT`            | yes      | `587`   | SMTP port                                                                      |
| `SMTP_USER`            | yes      | —       | SMTP username                                                                  |
| `SMTP_PASS`            | yes      | —       | SMTP password                                                                  |
| `SMTP_FROM`            | yes      | —       | From address (`Name <addr@example.com>`)                                       |
| `PUBLIC_URL`           | yes      | —       | Absolute URL where mig is reachable (for links in emails)                      |
| `MIN_NOTICE_HOURS`     | no       | `6`     | Minimum hours from now until first bookable slot                               |
| `BOOKING_HORIZON_DAYS` | no       | `14`    | Maximum days ahead bookable                                                    |
| `BLOCKED_DATES`        | no       | —       | Blocked dates, see syntax below                                                |
| `RATE_LIMIT_PER_5MIN`  | no       | `1`     | Max bookings per IP per 5 minutes                                              |
| `THEME`                | no       | `auto`  | `light`, `dark`, or `auto` (follow OS)                                         |
| `PORT`                 | no       | `8080`  | HTTP listen port                                                               |
| `HIDE_FOOTER` → `HIDE_BRANDING` | no | `false` | Set `true` to hide the "Powered by mig" footer + GitHub link. Renamed from `HIDE_FOOTER`; old name still works. |
| `GITHUB_URL`           | no       | (see)   | Override the URL the footer links to. Defaults to `https://github.com/spy4x/mig` |

### `WEEKLY_AVAILABILITY` syntax

Each entry: `DAY HH:MM-HH:MM`. `DAY` is
`MON`/`TUE`/`WED`/`THU`/`FRI`/`SAT`/`SUN`. A range `MON-FRI` expands to all
weekdays. Multiple ranges comma-separated.

```
MON-FRI 09:00-17:00          # weekdays, 9-17
MON-FRI 09:00-12:00,MON-FRI 14:00-18:00  # split with lunch
MON-THU 10:00-20:00,FRI 09:00-15:00      # different hours per day
```

### `BLOCKED_DATES` syntax

Single dates or ranges. Both `DD.MM.YYYY` and `YYYY-MM-DD` accepted. Inclusive
on both ends. Comma-separated, whitespace tolerant.

```
2026-12-24,2026-12-25,2026-12-26          # three single dates
01.01.2027-10.01.2027                    # a date range
01.01.2027-10.01.2027,04.07.2027        # range + single
```

## Architecture

Single-process Deno app. JSON file + atomic rename is the only persistence. SMTP
is the only network dependency at runtime.

```
Request → Fresh route → lib/* (pure) → bookings.mutate() (mutex)
                                            ↓
                                  JSON file (atomic write)
                                            ↓
                                  denomailer → SMTP → owner + guest
```

Mutations are serialised by an `AsyncMutex`. Reads are lock-free (memoised in
memory; reloaded from disk on cold start and after every mutation).

## Compile (standalone binary)

```bash
deno task compile
./mig
```

The binary is ~80 MB stripped and has zero runtime dependencies.

## License

MIT
