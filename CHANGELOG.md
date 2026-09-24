# Changelog

All notable changes to mig are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-09-24

**If you run mig from `antonshubin/mig:latest` under Watchtower or any other
auto-updater, it will pull this version on its own — and the effect depends on
your old setup.** On the old README's `docker run` command or Docker Compose
snippet, 0.4.0 keeps saving bookings fine, but every re-create — including the
auto-updater's own — loses them, and destroys your `CANCEL_SECRET` too; **do the
rescue steps below before you pin or redeploy anything.** On the old
`compose.example.yml` with `DATA_PATH` set (bookings on a root-owned host
mount), every booking instead fails outright with "We couldn't save your
booking", while `/health` keeps answering healthy — the container's log shows
`mig: persist FAILED`. Either way, pin your image to `v0.3.3`, or pause the
updater, until you've done the upgrade steps below.

### Changed

- **Breaking for existing bind mounts and named volumes.** The Docker image now
  runs as a non-root user (`deno`, uid/gid 1993) instead of root, matching what
  `SECURITY.md` already claimed. `/data` (the bookings directory) is created and
  owned by `deno` in the image, so a brand-new, empty Docker named volume
  mounted there inherits that ownership — but an existing bind mount or named
  volume, previously written to as root, is not automatically writable by uid
  1993 any more. See the upgrade note below.
- Env parsing and booking validation moved from Zod to arktype. Accept/reject
  decisions and the messages a visitor sees are unchanged; a startup error for a
  missing or malformed env var now names the variable without printing its value
  (#36).
- `HIDE_BRANDING` is now parsed as a real boolean, matched case-insensitively
  with surrounding whitespace ignored: `true`, `1` or `yes` hides the footer's
  "Powered by mig" line, and `false`, `0`, `no`, empty or absent shows it.
  Before, any non-empty value — including `false`, which `.env.example` ships —
  hid the line. Anything else now fails startup, naming `HIDE_BRANDING` (#35).

### Fixed

- Two different mount bugs, with two different consequences, both fixed by
  mounting `/data` instead:
  - The README's `docker run` command and its Docker Compose snippet mounted
    `./data:/app/data` and set no `DATA_PATH`, so bookings were written to
    `/data/bookings.json` purely inside the container — the `/app/data` mount
    was never actually read from or written to. Every booking was lost on the
    next re-create.
  - `compose.example.yml`, paired with `.env.example`'s
    `DATA_PATH=./data/bookings.json`, happened to work by accident: that path is
    relative to the image's `/app` working directory, which resolved to
    `/app/data/bookings.json` — the exact path the mount pointed at — so those
    bookings did land on the host, at `./data/bookings.json`, owned by root (the
    image ran as root before this change).
- `.env.example`'s `DATA_PATH=./data/bookings.json` line is now commented out.
  Uncommented and copied into a real `.env` used with the new
  `compose.example.yml` (now mounting `/data`), it would override the image's
  own `DATA_PATH=/data/bookings.json` and point the non-root process at a
  relative `./data` it has no permission to create inside the container. The
  image's own `Dockerfile` already sets `ENV DATA_PATH=/data/bookings.json`, so
  nothing needs it set explicitly for a Docker deployment — `lib/config.ts`'s
  own default is a different, relative path (`./data/bookings.json`), used only
  when nothing sets `DATA_PATH` at all, such as a non-Docker deploy.
- The date note on a hovered time slot now meets 4.5:1 contrast in the light
  theme (#33).

**`HIDE_BRANDING` upgrade note.** If your `.env` sets `HIDE_BRANDING=false` —
`.env.example` ships that value — the "Powered by mig" line and version now come
back in the footer, because `false` is no longer treated as "hide". A value that
isn't one of `true`/`1`/`yes`/`false`/`0`/`no`/empty (for example `on`) now
stops the container at startup instead of silently hiding the footer.

**Upgrade note.** Changing only the image, without also changing your mount,
loses existing bookings — read the step for your setup before redeploying.

**If you followed the README's `docker run` command or its Docker Compose
snippet, or `compose.example.yml` with no `DATA_PATH` in your `.env`:** your
bookings only ever lived inside the old container, at `/data/bookings.json` —
the `/app/data` mount was never read from. Without `DATA_PATH` set, the image's
own `ENV DATA_PATH=/data/bookings.json` (unchanged by this release) applies the
same way regardless of which of these you followed. Rescue them first, before
you touch the mount or recreate the container:

```bash
docker stop mig
docker inspect mig --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^CANCEL_SECRET='
docker cp mig:/data/bookings.json .
docker rm mig
sudo mv bookings.json ./data/bookings.json
sudo chown -R 1993:1993 ./data
```

`docker cp` can't write straight into `./data` — Docker auto-created that
directory owned by root when the old container first started, since the old
instructions never had you create it yourself. Copy to the current directory
first, then move it in. `docker rm mig` clears the stopped container so the next
`docker run --name mig ...` (or `docker compose up`) doesn't fail with "name
already in use" — but it also destroys the only copy of the old container's
`CANCEL_SECRET`, which the old README generated inline and never wrote to a
file, so the `docker inspect` line above prints it first. Use only the part
after `CANCEL_SECRET=` as the value — the printed line starts with
`CANCEL_SECRET=` itself, so pasting the whole thing gives you
`CANCEL_SECRET=CANCEL_SECRET=...`. Put that value in place of
`$(openssl rand -base64 32)` when you redeploy, so cancel links already sent by
email keep working.

**Everyone: change the mount.** Wherever your `docker run` command or
`compose.yml` has `./data:/app/data`, change it to `./data:/data:z` — only the
container side of the mount moves, from `/app/data` to `/data`; the host path
(`./data`) stays the same. The image stores bookings at `/data/bookings.json`;
if you also remove `DATA_PATH` from your `.env` (see above) without changing the
mount too, storage silently moves back inside the container — nothing lands on
the host, and it's gone on the next re-create.

**If you followed `compose.example.yml` with `.env.example`'s
`DATA_PATH=./data/bookings.json`:** your bookings are already on the host, at
`./data/bookings.json`, owned by root. Apply the mount change above, remove
(comment out) `DATA_PATH` from your `.env`, then:

```bash
sudo chown -R 1993:1993 ./data
```

and redeploy.

**If you used a named volume instead of a bind mount for that setup**
(`<volume>:/app/data`, `DATA_PATH` still set): move it the same way — change the
mount to `<volume>:/data`, drop `DATA_PATH`, then chown the volume with the
`docker run --rm -v ... alpine chown` command below instead of `sudo chown -R`,
since there's no host path to chown directly.

**If you're on a Docker named volume** (`-v <volume>:/data`) that mig already
wrote to before this change: it's still owned by root from the old image, so
`/health` answers fine but every booking fails with "We couldn't save your
booking" until you chown the volume too:

```bash
docker run --rm -v <volume>:/data alpine chown -R 1993:1993 /data
```

Replace `<volume>` with your volume's name.

A brand-new, empty named volume needs no such step — see `AGENTS.md`.

Two things that apply either way: `:z` relabels the _entire_ directory for
container access, so point it only at a folder that belongs to mig alone, never
a home directory, `/srv`, or `/etc`. And `sudo chown 1993:1993` assumes rootful
Docker; rootless Podman remaps container uids to a different host range, so
there use `--userns=keep-id --user "$(id -u):$(id -g)"` instead of chowning
anything to 1993 — see the README's Docker quick start for that command in full.

## [0.3.3] - 2026-09-24

### Fixed

- Both correction emails a host receives after a failed guest send — successful
  rollback and failed rollback — are now pinned word for word by tests, so a
  wording change can no longer slip through unnoticed (#32).
- Text across the app now meets the 4.5:1 minimum contrast in both themes: the
  Confirm button and step badges, secondary text, the footer, form placeholders
  and the Cancel button (#34).

## [0.3.2] - 2026-09-23

### Fixed

- The owner's calendar invite now shows the visitor's clock alongside the
  host's, matching the owner email (#26).
- A failed booking email no longer tells the visitor their own email failed; it
  now says the booking wasn't created (#26).
- The correction email sent when the rollback itself fails to save now says so,
  instead of claiming the booking was removed and the slot is free again (#30).

## [0.3.1] - 2026-09-23

### Fixed

- The push notification sent after a failed booking email now says whether the
  booking was actually removed, instead of always claiming the rollback
  succeeded (#28).

## [0.3.0] - 2026-09-23

### Added

- Two clocks, everywhere: a visitor sees every time in their own zone, and the
  owner sees the host zone with the visitor's clock alongside it, on every page
  and in every email (#18).
- The Docker image is published to Docker Hub (`antonshubin/mig`) from CI, on a
  `v<version>` tag push, instead of by hand (#9, #22).

### Changed

- License switched to AGPL-3.0 (#12).
- No Woodpecker pipeline had ever run successfully for mig — every merge so far
  relied on local checks alone, because `deno check` ran without `deno install`
  first and `deno.json`'s `nodeModulesDir: "manual"` needs one (#16). A pipeline
  started by hand also failed outright, and after the webhook was re-created
  every push and PR pipeline ended in `error` too — both from a tag-only
  `release` step that could never have worked. `check` now installs dependencies
  first and runs on push, pull request, tag and manual events; the broken
  `release` step was removed so it could no longer break every pipeline —
  publishing was reintroduced properly afterwards, in #22 above (#20).
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
[0.4.0]: https://github.com/spy4x/mig/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/spy4x/mig/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/spy4x/mig/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/spy4x/mig/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/spy4x/mig/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/spy4x/mig/releases/tag/v0.2.0
