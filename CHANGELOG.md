# Changelog

All notable changes to mig are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-09-23

### Changed

- **Breaking for existing bind mounts and named volumes.** The Docker image now
  runs as a non-root user (`deno`, uid/gid 1993) instead of root, matching what
  `SECURITY.md` already claimed. `/data` (the bookings directory) is created and
  owned by `deno` in the image, so a brand-new, empty Docker named volume
  mounted there inherits that ownership — but an existing bind mount or named
  volume, previously written to as root, is not automatically writable by uid
  1993 any more. See the upgrade note below.

### Fixed

- The README's Docker quick start and Docker Compose example, and
  `compose.example.yml`, mounted bookings at `/app/data` inside the container.
  `DATA_PATH` actually points at `/data/bookings.json`, so bookings following
  those examples lived inside the container and were lost whenever it was
  recreated. Both now mount `/data`.
- `.env.example`'s `DATA_PATH=./data/bookings.json` line is now commented out.
  Uncommented and copied into a real `.env` used with `compose.example.yml`, it
  overrode the image's own `DATA_PATH=/data/bookings.json` and pointed the
  non-root process at a relative `./data` it has no permission to create inside
  the container. `lib/config.ts` already defaults to the same path, so nothing
  needs it set explicitly for a Docker deployment.
- The push notification sent after a failed booking email now says whether the
  booking was actually removed, instead of always claiming the rollback
  succeeded (#28).

**Upgrade note.** After updating to this version:

- If your `.env` sets `DATA_PATH=./data/bookings.json` (copied from an older
  `.env.example`), remove that line — it now breaks the Docker deployment
  instead of merely being redundant (see above).
- An **existing host bind mount** for `/data` was written to as root and is not
  writable by uid 1993. Fix it on the host: `sudo chown 1993:1993 <dir>`.
  Without this, the container still starts and `/health` still answers 200 — the
  failure only shows up when a visitor tries to book: the save fails and they
  see "We couldn't save your booking. Please try again in a moment."
  (`lib/bookings.ts`'s temp-file-then-rename can't write into a directory it
  doesn't own).
- An **existing named volume** first used by 0.3.0 or earlier has the same
  problem — its `/data` and `bookings.json` were created by the old root
  process. Fix it without a host shell, using a throwaway container:
  `docker run --rm -v <volume>:/data alpine chown -R 1993:1993 /data`. A **new,
  empty** named volume needs no fix — the image creates `/data` owned by `deno`
  itself.

## [0.3.0] - 2026-09-23

### Added

- Two clocks, everywhere: a visitor sees every time in their own zone, and the
  owner sees the host zone with the visitor's clock alongside it, on every page
  and in every email (#18).
- The Docker image is published to Docker Hub (`antonshubin/mig`) again, now
  from CI on a `v<version>` tag push instead of by hand (#9, #22).

### Changed

- License switched to AGPL-3.0 (#12).
- No Woodpecker pipeline had ever run successfully for mig — every merge so far
  relied on local checks alone, because `deno check` ran without `deno install`
  first and `deno.json`'s `nodeModulesDir: "manual"` needs one (#16). A pipeline
  started by hand also failed outright, and after the webhook was re-created
  every push and PR pipeline ended in `error` too — both from a tag-only
  `release` step that could never have worked. `check` now installs dependencies
  first and runs on push, pull request, tag and manual events; `release` was
  removed (#20).
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

[Unreleased]: https://github.com/spy4x/mig/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/spy4x/mig/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/spy4x/mig/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/spy4x/mig/compare/da42265...v0.2.0
