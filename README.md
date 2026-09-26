<div align="center">

# mig ⏱

**A tiny self-hosted meeting scheduler. One owner, one link, no database.**

[![CI](https://ci.antonshubin.com/api/badges/12/status.svg)](https://ci.antonshubin.com/repos/12)
[![Docker](https://img.shields.io/badge/docker-antonshubin%2Fmig-blue?logo=docker)](https://hub.docker.com/r/antonshubin/mig)
[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

[**Try it live →**](https://meet.antonshubin.com) ·
[Self-hosting](docs/self-hosting.md) · [Configuration](docs/configuration.md) ·
[Embedding](docs/embedding.md) · [How it works](docs/how-it-works.md) ·
[Changelog](CHANGELOG.md)

![A visitor books a meeting: picks a date in the calendar, picks 15:30, types a name and email, confirms, and lands on the "You're booked" page.](docs/screenshots/booking-flow.gif)

</div>

A visitor picks a free slot, and you both get an email with a calendar invite
and a cancel link. That's the whole product. **mig** (миг, Russian for "moment")
is the "book a call with me" link on your own site, without a Calendly
subscription or a cal.com stack of Postgres and Redis to run.

I built it for my own site and book my calls through it at
[meet.antonshubin.com](https://meet.antonshubin.com).

## Why mig

- **Nothing to operate.** One small container, bookings in one JSON file you can
  `cat` and back up. No database, no accounts, no admin UI.
- **Config is code.** Working hours, days off, slot length and the meeting link
  are environment variables. Change them, restart, done.
- **Both clocks, everywhere.** Guests see times in their own time zone. Your
  emails show your time and the guest's side by side.
- **Invite and cancel built in.** Every confirmation carries an `.ics` invite
  and a signed cancel link. Optional push notifications through NTFY.
- **Embeds anywhere.** `/embed` drops the whole flow into an iframe on your
  site, resizes itself and takes your site's theme with `?theme=`.
- **Web standards.** Fetch, Web Crypto and ES modules on Deno, with Fresh and
  Tailwind. Runs as a non-root Docker image or a single binary.

<img src="docs/screenshots/email-confirmation.png" alt="The guest's confirmation email: subject &quot;Booking confirmed&quot;, the meeting's date and time in Berlin time, the meeting link, a note about the attached calendar invite, and a cancel link." width="640">

**Use it if** you want one booking link for yourself. **Skip it if** you need
teams, payments, several event types, calendar sync or thousands of bookings a
day.

## Quick start

```yaml
# compose.yml
services:
  mig:
    image: antonshubin/mig:latest
    restart: unless-stopped
    ports: ["8080:8080"]
    volumes: ["./data:/data:z"]
    env_file: .env
```

```bash
cp .env.example .env    # fill in your name, hours, SMTP and a CANCEL_SECRET
mkdir -p data && sudo chown 1993:1993 data   # the container runs as uid 1993
docker compose up -d
```

Open `http://localhost:8080`. Put it behind a TLS reverse proxy before you share
the link: [self-hosting.md](docs/self-hosting.md) covers `docker run`, Podman,
SELinux, reverse proxies and the standalone binary.

## Configuration

The ones you must set:

| Variable              | Example                                   |
| --------------------- | ----------------------------------------- |
| `HOST_NAME`           | `Jane Doe`                                |
| `HOST_EMAIL`          | `jane@example.com`                        |
| `HOST_TZ`             | `Europe/Berlin`                           |
| `MEETING_URL`         | `https://meet.google.com/abc-defg-hij`    |
| `WEEKLY_AVAILABILITY` | `MON-FRI 09:00-12:00,MON-FRI 14:00-18:00` |
| `SLOT_DURATION_MIN`   | `30`                                      |
| `PUBLIC_URL`          | `https://meet.example.com`                |
| `CANCEL_SECRET`       | output of `openssl rand -base64 32`       |
| `SMTP_*`              | host, port, user, password, from          |

Blocked dates, notice period, booking horizon, rate limit, theme, branding and
NTFY are optional: see [configuration.md](docs/configuration.md).

## Embed it

```html
<iframe src="https://meet.example.com/embed?theme=dark" title="Book a meeting"
  style="width:100%;max-width:36rem;border:0"></iframe>
```

Framing headers, auto-resizing and time zones:
[embedding.md](docs/embedding.md).

## Development

```bash
deno install && deno task dev   # dev server with hot reload
deno task check && deno task test
```

Contributions are welcome within mig's narrow scope: see
[CONTRIBUTING.md](CONTRIBUTING.md). Security reports:
[SECURITY.md](SECURITY.md).

## Built by

I'm [Anton Shubin](https://antonshubin.com), a senior full-stack engineer and
tech lead. mig is one of the small tools I build and run on my own servers. Need
something like it built for your product?
[That's my day job →](https://antonshubin.com)

Licensed under [AGPL-3.0](LICENSE). Copyright (C) 2026 Anton Shubin.

---

Made by Anton Shubin ·
[antonshubin.com/tools](https://antonshubin.com/tools)
