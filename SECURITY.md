# Security

## Supported versions

| Version  | Supported          |
| -------- | ------------------ |
| latest   | :white_check_mark: |
| < latest | :x:                |

Only the latest tagged release receives security updates.

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Email `spy4x@users.noreply.github.com` with:

1. A description of the issue
2. Steps to reproduce
3. Affected versions

You'll get an acknowledgement within 72 hours. mig is a tiny self-hosted tool;
the threat model is "single user, single instance, trusted SMTP relay". We will
coordinate disclosure on a timeline that makes sense for the actual exposure.

## Hardening checklist for self-hosters

- [ ] Run mig behind a TLS-terminating reverse proxy (Traefik, Caddy, nginx).
      Don't expose port 8080 to the internet directly.
- [ ] Keep `CANCEL_SECRET` ≥ 32 random bytes (`openssl rand -base64 32`). Rotate
      it to invalidate all outstanding cancel links.
  - **WARNING**: rotating `CANCEL_SECRET` cancels nobody — every active booking
    keeps its old token hash, and old cancel links become invalid. Owners lose
    the ability to cancel those bookings via link (you'd need to mutate the JSON
    manually or wait them out).
- [ ] Run the mig container as non-root (default in our Dockerfile).
- [ ] Mount the bookings JSON file as a read-write volume so it survives
      container restarts.
- [ ] Back up the JSON file. It's the only persistent state.
- [ ] Don't log raw SMTP credentials. mig only logs SMTP errors at startup
      (`mig: SMTP connect failed (host:port): ...`).
- [ ] The rate-limit map is in-memory only — restart resets it. For public
      exposure, add Cloudflare or Traefik in front.

## Threat model

**In scope:**

- Spam protection (honeypot + per-IP rate limit).
- Tampering with cancel links (HMAC-SHA-256 of random token).
- Email injection (Zod-validated fields; SMTP via denomailer).
- Booking slot conflicts (atomic mutex around read-modify-write).

**Out of scope:**

- Multi-tenancy (mig has exactly one owner, defined by env).
- Calendar sync (no Google/Outlook OAuth).
- DoS protection beyond the rate limit (use Cloudflare in front).
- Confidentiality of the JSON file at rest (use disk encryption if this matters
  — PII is in there).
