# Changelog

All notable changes to mig are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-09-23

### Fixed

- The Docker image now runs as a non-root user (`deno`, uid/gid 1993) instead of
  root, matching what `SECURITY.md` already claimed. `/data` (the bookings
  directory) is created and owned by `deno` in the image, so a Docker named
  volume mounted there inherits that ownership.
- The README's Docker quick start and Docker Compose example, and
  `compose.example.yml`, mounted bookings at `/app/data` inside the container.
  `DATA_PATH` actually points at `/data/bookings.json`, so bookings following
  those examples lived inside the container and were lost whenever it was
  recreated. Both now mount `/data`.
- The push notification sent after a failed booking email now says whether the
  booking was actually removed, instead of always claiming the rollback
  succeeded.

**Upgrade note:** an existing host bind mount for `/data` must be writable by
uid 1993 (`chown 1993:1993 <dir>`), or the container must be run with
`--user "$(id -u):$(id -g)"` / a compose `user:` line — see the README's Docker
quick start.

## [0.3.0] - 2026-09-23

### Added

- Two clocks, everywhere: a visitor sees every time in their own zone, and the
  owner sees the host zone with the visitor's clock alongside it, on every page
  and in every email (#18).
- The Docker image is published to Docker Hub (`antonshubin/mig`) again, now
  from CI on a `v<version>` tag push instead of by hand (#9, #22).

### Changed

- License switched to AGPL-3.0 (#12).
- The CI pipeline runs reliably again: `deno install` runs before
  `check`/`build`, and the broken tag-only `release` step that failed every push
  and PR pipeline was removed (#16, #20).
- `deno install` in CI's `check` step now runs `--frozen`, so a `deno.lock` that
  no longer matches `deno.json` fails the build instead of being silently
  rewritten; `AGENTS.md`'s stack docs were also corrected to match the real
  container and build (#23).

### Fixed

- `/embed`'s booking flow: every step (date, time, confirm, confirmation) now
  stays under `/embed`, instead of the first click landing on the full site with
  header and footer (#14).
- Two visitors racing for the same slot could both receive a "booking confirmed"
  email for a booking that was never actually saved. Bookings now save before
  any email goes out, and a failed save or send rolls the booking back (#24).
- The Docker image's build stage now installs dependencies with
  `deno install --frozen` from `deno.lock`, the same as CI, instead of a
  separate `npm install` by version range — the two had drifted, and the
  published image shipped a different `@preact/signals` version than CI tested
  (#25).

## [0.2.0] - 2026-09-18

Initial release: standalone booking page (`/`), iframe embed (`/embed`),
confirmation page (`/confirmed`), cancellation flow (`/cancel`), healthcheck
(`/health`), and a JSON API (`/api/slots`, `/api/book`, `/api/cancel`). Weekly
availability and blocked dates configured via env vars, per-IP rate limiting,
HMAC-signed stateless cancellation tokens, an ICS calendar attachment on every
confirmation, plain-text + HTML email, dark/light theme with OS auto-detection,
and a Debian-based Docker image published to `antonshubin/mig` on Docker Hub. A
single-binary deploy via `deno compile` was also available as an alternative to
the container.

[0.4.0]: https://github.com/spy4x/mig/compare/v0.3.0...main
[0.3.0]: https://github.com/spy4x/mig/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/spy4x/mig/compare/da42265...v0.2.0
