# Configuring mig

All behaviour comes from environment variables, validated at startup: a missing
or malformed required variable stops the process.
[`.env.example`](../.env.example) is a commented template.

| Env var                | Required | Default | Description                                                                                                                                                                                                                                              |
| ---------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOST_NAME`            | yes      | —       | Owner's display name                                                                                                                                                                                                                                     |
| `HOST_EMAIL`           | yes      | —       | Owner's email (receives booking + cancel notifications)                                                                                                                                                                                                  |
| `HOST_TZ`              | yes      | —       | IANA timezone, e.g. `Europe/Berlin`                                                                                                                                                                                                                      |
| `MEETING_URL`          | yes      | —       | Static meeting URL embedded in every confirmation                                                                                                                                                                                                        |
| `WEEKLY_AVAILABILITY`  | yes      | —       | Comma-separated `DAY HH:MM-HH:MM` list, e.g. `MON-FRI 09:00-17:00` (see below)                                                                                                                                                                           |
| `SLOT_DURATION_MIN`    | yes      | —       | Slot length in minutes (e.g. 30)                                                                                                                                                                                                                         |
| `CANCEL_SECRET`        | yes      | —       | Secret for cancel links: at least 32 printable ASCII characters, e.g. `openssl rand -base64 32`                                                                                                                                                          |
| `SMTP_HOST`            | yes      | —       | SMTP server hostname                                                                                                                                                                                                                                     |
| `SMTP_PORT`            | yes      | `587`   | SMTP port                                                                                                                                                                                                                                                |
| `SMTP_USER`            | yes      | —       | SMTP username                                                                                                                                                                                                                                            |
| `SMTP_PASSWORD`        | yes      | —       | SMTP password. Wrap in single quotes if it contains shell-special characters.                                                                                                                                                                            |
| `SMTP_FROM`            | yes      | —       | From address (`Name <addr@example.com>`)                                                                                                                                                                                                                 |
| `PUBLIC_URL`           | yes      | —       | Absolute URL where mig is reachable (for links in emails)                                                                                                                                                                                                |
| `MIN_NOTICE_HOURS`     | no       | `6`     | Minimum hours from now until first bookable slot                                                                                                                                                                                                         |
| `BOOKING_HORIZON_DAYS` | no       | `14`    | Maximum days ahead bookable                                                                                                                                                                                                                              |
| `BLOCKED_DATES`        | no       | —       | Blocked dates, see syntax below                                                                                                                                                                                                                          |
| `RATE_LIMIT_PER_5MIN`  | no       | `1`     | Max bookings per IP per 5 minutes                                                                                                                                                                                                                        |
| `TRUSTED_PROXY_HEADER` | no       | —       | The one header mig reads a visitor's address from, for the rate limit: `cf-connecting-ip`, `x-forwarded-for` or `x-real-ip`. Unset trusts no header. Any other value stops startup. See [Behind a reverse proxy](self-hosting.md#behind-a-reverse-proxy) |
| `THEME`                | no       | `auto`  | Default theme for a visitor who hasn't picked one with the toggle: `light`, `dark`, or `auto` (follow OS). `/embed` uses it unless `?theme=light` or `?theme=dark` is given                                                                              |
| `PORT`                 | no       | `8080`  | HTTP listen port                                                                                                                                                                                                                                         |
| `HIDE_BRANDING`        | no       | `false` | `true`/`1`/`yes` hides the "Powered by mig" footer + GitHub link; `false`/`0`/`no`/empty/absent shows it. Case-insensitive, trimmed. Any other value stops startup.                                                                                      |
| `GITHUB_URL`           | no       | (see)   | Override the URL the footer links to. Defaults to `https://github.com/spy4x/mig`                                                                                                                                                                         |
| `NTFY_URL`             | no       | —       | NTFY server base URL (e.g. `https://ntfy.example.com`). All four NTFY vars must be set to enable.                                                                                                                                                        |
| `NTFY_TOPIC`           | no       | —       | NTFY topic to publish to.                                                                                                                                                                                                                                |
| `NTFY_TOKEN`           | no       | —       | NTFY bearer token.                                                                                                                                                                                                                                       |
| `NTFY_MODE`            | no       | `all`   | Which events push: `all`, `errors`, `booking`, or `cancel`.                                                                                                                                                                                              |

`DATA_PATH` (where bookings are stored) and `MIG_VERSION` (the version shown in
the footer) are described in [`.env.example`](../.env.example).

## `WEEKLY_AVAILABILITY` syntax

Each entry: `DAY HH:MM-HH:MM`. `DAY` is
`MON`/`TUE`/`WED`/`THU`/`FRI`/`SAT`/`SUN`. A range `MON-FRI` expands to all
weekdays. Multiple ranges comma-separated.

```
MON-FRI 09:00-17:00          # weekdays, 9-17
MON-FRI 09:00-12:00,MON-FRI 14:00-18:00  # split with lunch
MON-THU 10:00-20:00,FRI 09:00-15:00      # different hours per day
```

## `BLOCKED_DATES` syntax

Single dates or ranges. Both `DD.MM.YYYY` and `YYYY-MM-DD` accepted. Inclusive
on both ends. Comma-separated, whitespace tolerant.

```
2026-12-24,2026-12-25,2026-12-26          # three single dates
01.01.2027-10.01.2027                    # a date range
01.01.2027-10.01.2027,04.07.2027        # range + single
```
