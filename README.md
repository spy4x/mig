# mig ⏱

[![Docker](https://img.shields.io/badge/docker-antonshubin%2Fmig-blue)](https://hub.docker.com/r/antonshubin/mig)
[![Deno](https://img.shields.io/badge/deno-2.x-black?logo=deno)](https://deno.land)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
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
- **Two clocks, everywhere.** The visitor sees times in their own zone — city
  and UTC offset next to every time, e.g. `11:00, New York, UTC-4`, with its
  date converted alongside it — on the slot list, confirm step, confirmation
  page and cancel page, and in every email they receive. The owner sees the same
  for the host zone, plus the visitor's clock (and date, when it differs)
  alongside it in the owner's booking/cancellation emails and the NTFY push, so
  they always know both the time and where the visitor is. Guest zone is
  auto-detected in the browser; without JavaScript, times fall back to the
  host's zone, labelled as such.
- **Iframe-ready.** `/embed` strips chrome for use inside another page, and
  every step of the booking flow — date, time, confirm, the confirmation page —
  stays under `/embed`. See [Embedding](#embedding).
- **Dark + light theme.** Tailwind v4, follows OS preference, toggle persists in
  localStorage.
- **Modern stack.** Fresh 2 (Preact + JSX), Tailwind v4, single binary via
  `deno compile`.

## Quick start

### Docker

```bash
docker run -d --name mig \
  -p 8080:8080 \
  -v ./data:/data \
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
  -e SMTP_PASSWORD=<REDACTED:SMTP_PASSWORD> \
  -e SMTP_FROM="Bookings <book@example.com>" \
  -e CANCEL_SECRET=$(openssl rand -base64 32) \
  -e PUBLIC_URL=https://meet.example.com \
  antonshubin/mig:latest
```

The container runs as `deno`, uid/gid 1993 — not root. `./data` must be writable
by that uid. A fresh directory only your own user can write is owned by _your_
uid, not 1993, so make it writable first:

```bash
mkdir -p ./data && chown 1993:1993 ./data
```

or, instead of `chown`, run the container as your own user (it already owns the
directory it just created):

```bash
docker run --user "$(id -u):$(id -g)" ...
```

A Docker named volume (`-v mig-data:/data` instead of a host path) needs neither
step — Docker creates it owned by `deno` already, since `/data` inside the image
is.

### Docker Compose

```yaml
services:
  mig:
    image: antonshubin/mig:latest
    container_name: mig
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data
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
      SMTP_PASSWORD: "<REDACTED:SMTP_PASSWORD>"
      SMTP_FROM: "Bookings <book@example.com>"
      CANCEL_SECRET: "<REDACTED:CANCEL_SECRET>"
      PUBLIC_URL: "https://meet.example.com"
```

`./data` needs the same non-root fix as the Docker quick start above
(`chown 1993:1993 ./data`, or add `user: "1000:1000"` — your own uid/gid — to
the service).

See `.env.example` for the full list of env vars.

## Configuration

| Env var                | Required | Default | Description                                                                                                                                                         |
| ---------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST_NAME`            | yes      | —       | Owner's display name                                                                                                                                                |
| `HOST_EMAIL`           | yes      | —       | Owner's email (receives booking + cancel notifications)                                                                                                             |
| `HOST_TZ`              | yes      | —       | IANA timezone, e.g. `Europe/Berlin`                                                                                                                                 |
| `MEETING_URL`          | yes      | —       | Static meeting URL embedded in every confirmation                                                                                                                   |
| `WEEKLY_AVAILABILITY`  | yes      | —       | Comma-separated `DAY HH:MM-HH:MM` list, e.g. `MON-FRI 09:00-17:00` (see below)                                                                                      |
| `SLOT_DURATION_MIN`    | yes      | —       | Slot length in minutes (e.g. 30)                                                                                                                                    |
| `CANCEL_SECRET`        | yes      | —       | Random 32+ byte secret for HMAC sign/verify                                                                                                                         |
| `SMTP_HOST`            | yes      | —       | SMTP server hostname                                                                                                                                                |
| `SMTP_PORT`            | yes      | `587`   | SMTP port                                                                                                                                                           |
| `SMTP_USER`            | yes      | —       | SMTP username                                                                                                                                                       |
| `SMTP_PASSWORD`        | yes      | —       | SMTP password. Wrap in single quotes if it contains shell-special characters.                                                                                       |
| `SMTP_FROM`            | yes      | —       | From address (`Name <addr@example.com>`)                                                                                                                            |
| `PUBLIC_URL`           | yes      | —       | Absolute URL where mig is reachable (for links in emails)                                                                                                           |
| `MIN_NOTICE_HOURS`     | no       | `6`     | Minimum hours from now until first bookable slot                                                                                                                    |
| `BOOKING_HORIZON_DAYS` | no       | `14`    | Maximum days ahead bookable                                                                                                                                         |
| `BLOCKED_DATES`        | no       | —       | Blocked dates, see syntax below                                                                                                                                     |
| `RATE_LIMIT_PER_5MIN`  | no       | `1`     | Max bookings per IP per 5 minutes                                                                                                                                   |
| `THEME`                | no       | `auto`  | `light`, `dark`, or `auto` (follow OS)                                                                                                                              |
| `PORT`                 | no       | `8080`  | HTTP listen port                                                                                                                                                    |
| `HIDE_BRANDING`        | no       | `false` | `true`/`1`/`yes` hides the "Powered by mig" footer + GitHub link; `false`/`0`/`no`/empty/absent shows it. Case-insensitive, trimmed. Any other value stops startup. |
| `GITHUB_URL`           | no       | (see)   | Override the URL the footer links to. Defaults to `https://github.com/spy4x/mig`                                                                                    |
| `NTFY_URL`             | no       | —       | NTFY server base URL (e.g. `https://ntfy.example.com`). All four NTFY vars must be set to enable.                                                                   |
| `NTFY_TOPIC`           | no       | —       | NTFY topic to publish to.                                                                                                                                           |
| `NTFY_TOKEN`           | no       | —       | NTFY bearer token.                                                                                                                                                  |
| `NTFY_MODE`            | no       | `all`   | Which events push: `all`, `errors`, `booking`, or `cancel`.                                                                                                         |

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

## Embedding

Drop the booking flow into another page with an iframe:

```html
<iframe
  src="https://meet.example.com/embed"
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

## Architecture

Single-process Deno app. JSON file + atomic rename is the only persistence. SMTP
is the only network dependency at runtime.

```
Request → Fresh route → lib/* (pure) → bookings.mutate() (mutex)
                                            ↓
                                  JSON file (atomic write)
                                            ↓
                                  nodemailer → SMTP → owner + guest
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

Copyright (C) 2026 Anton Shubin

Licensed under [AGPL-3.0](LICENSE). Contribution terms are in
[CONTRIBUTING.md](CONTRIBUTING.md).
