# mig

**mig** is a tiny self-hosted meeting scheduler. One owner, one URL, one
feature: a visitor picks a time slot and both of you get an email with a
calendar invite and a cancel link.

No database, no accounts, no admin UI. mig reads its configuration from
environment variables and keeps bookings in one JSON file. The server is built
on web standards (Fetch, Web Crypto, Streams, ES modules) and runs on Deno 2 in
a small Debian-based image, as a non-root user.

- Source, full documentation and screenshots:
  [github.com/spy4x/mig](https://github.com/spy4x/mig)
- Live instance: [meet.antonshubin.com](https://meet.antonshubin.com)
- Changelog: [CHANGELOG.md](https://github.com/spy4x/mig/blob/main/CHANGELOG.md)

## Tags

- `latest`: the most recent stable release.
- `vX.Y.Z`: one release, for example `v0.4.1`. Pin one of these in production.
- `vX.Y.Z-rc.N`: a pre-release. It never moves `latest`.

## Quick start

```bash
mkdir -p ./data && sudo chown 1993:1993 ./data
docker run -d --name mig -p 8080:8080 -v ./data:/data:z \
  -e HOST_NAME="Jane Doe" \
  -e HOST_EMAIL="jane@example.com" \
  -e HOST_TZ="Europe/Berlin" \
  -e MEETING_URL="https://meet.example.com/room" \
  -e WEEKLY_AVAILABILITY="MON-FRI 09:00-17:00" \
  -e SLOT_DURATION_MIN=30 \
  -e SMTP_HOST=smtp.example.com -e SMTP_PORT=587 \
  -e SMTP_USER=jane@example.com -e SMTP_PASSWORD='change-me' \
  -e SMTP_FROM="Bookings <book@example.com>" \
  -e CANCEL_SECRET="$(openssl rand -base64 32)" \
  -e PUBLIC_URL=https://meet.example.com \
  antonshubin/mig:latest
```

The container runs as uid/gid 1993, so `./data` must be writable by that user.
Every variable, the Docker Compose file, embedding in your own site and the
upgrade notes are in the [README](https://github.com/spy4x/mig#readme).

## License

AGPL-3.0. Made by Anton Shubin, [antonshubin.com](https://antonshubin.com).
