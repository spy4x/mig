# Changelog

All notable changes to mig are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release: standalone booking page (`/`), iframe embed (`/embed`),
  confirmation page (`/confirmed`), cancellation flow (`/cancel`), healthcheck
  (`/health`), JSON API (`/api/slots`, `/api/book`, `/api/cancel`).
- Weekly availability config via env (`WEEKLY_AVAILABILITY`).
- Blocked dates with range + single-date syntax (`BLOCKED_DATES`).
- Per-IP rate limit (default 1 / 5 min).
- HMAC-signed cancellation tokens (no per-booking persistence).
- ICS calendar attachment on every confirmation.
- Plain-text + HTML multipart email with inline-styled HTML.
- Dark + light theme with OS auto-detection, manual toggle persisted in
  localStorage.
- Single-binary deploy via `deno compile`.
- Distroless container (~25 MB) at `ghcr.io/spy4x/mig`.
