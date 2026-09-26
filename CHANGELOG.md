# Changelog

All notable changes to mig are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- The booking rate limit can no longer be bypassed by sending a made-up
  `CF-Connecting-IP`, `X-Forwarded-For` or `X-Real-IP` header. mig trusted all
  three on every request, even with no proxy in front, so a script that changed
  the header each time could fill every slot and send the host unlimited email.
  mig now trusts no header unless `TRUSTED_PROXY_HEADER` names one, and falls
  back to the connection's address. Visitors without those headers no longer
  share one limit either (#59).

### Upgrade notes

- Behind a reverse proxy or Cloudflare, set `TRUSTED_PROXY_HEADER` to the header
  your proxy sets (`x-real-ip` for Traefik with default settings,
  `cf-connecting-ip` for Cloudflare). `cf-connecting-ip` is safe only when the
  server accepts connections from Cloudflare alone; a client that reaches the
  server directly can send any value in it. Without the setting, every visitor
  shares the proxy's address and its one limit: with the default
  `RATE_LIMIT_PER_5MIN=1`, one booking blocks everyone else for five minutes.
  Unset or empty trusts no header; any other value stops mig at startup. See the
  README's "Behind a reverse proxy" (#59).

## [0.6.1] - 2026-09-26

### Fixed

- `THEME` takes effect. On the standalone pages, a visitor with nothing stored
  sees the owner's `THEME`, and a theme the visitor picked still wins. `/embed`
  follows `THEME` unless its address carries `?theme=light` or `?theme=dark`
  (#52). Upgrade note: if you set `THEME` earlier, when it did nothing, your
  pages and embeds now use it. On `/embed`, a `THEME` of `light` or `dark` also
  overrides a theme the visitor stored, and applies to an address that carries
  `?theme=auto`.
- The day named above the time grid, in the date card and in the mobile summary
  bar is the day the visitor clicked, unless it has slots and none of them falls
  on that day in the visitor's time zone; then it is the first slot's day.
  Before, it was the visitor's date at the host's noon, so a Tokyo host's Sunday
  evening could be labelled Saturday for a visitor in New York (#50).
- Slot, calendar-day, month and "Change" links are no longer announced as
  "current" by screen readers; only the selected day and the selected time keep
  that mark (#50).

## [0.6.0] - 2026-09-26

### Added

- `deno task screenshots` writes every README picture and the GitHub social
  preview from a local build, with placeholder data, a local SMTP sink and a
  pinned Playwright, so the pictures can be regenerated on any checkout (#53).

### Changed

- mig uses `@spy4x/time` and `@spy4x/platform` for timezone math, the `.ics`
  invite and the booking rate limiter, instead of its own copies (#57).
- The README opens with the CI badge, a screenshot of the booking page and a
  one-line `docker run`, and describes mig as a web-standards app that runs on
  Deno in a small Docker image. New screenshots in light and dark, a GIF of the
  booking flow and a picture of the confirmation email replace the two old ones
  (#43).
- An invite for a cancelled booking is sent as `METHOD:CANCEL`, not
  `METHOD:REQUEST` (#57).
- An impossible date or time in a link or form (`2026-02-31`, `24:00`) is
  ignored on `/` and `/embed`, answered with 400 by `/api/slots`, and refused
  with an error by the booking form, instead of silently becoming another day
  (#57). The same applies to any date or month before 1980 (`?date=`,
  `?month=`). Until 1972 some zones ran on a local mean time whose UTC offset
  had seconds, such as New York's -4:56:02 before 1883, and the new timezone
  code does not resolve those. A booking already saved with an impossible date
  is read as the date the visitor was told.

### Fixed

- A booking near a daylight-saving change starts at the right time. Before, a
  slot within one UTC offset of the change was off by an hour, in the invite and
  everywhere else it was shown: for example, an Auckland host's 15:00 slot on
  the day before clocks go back (#57).
- On the day clocks spring forward, the slots that fall in the skipped hour
  (02:00 and 02:30 in Berlin) are no longer offered, and a booking for one is
  refused. Before, they duplicated the slots an hour earlier (#57).

### Upgrade notes

- An impossible date in `BLOCKED_DATES`, such as `2026-02-30`, now stops mig at
  startup with `entry N: not a real calendar date`. Under
  `restart: unless-stopped` that is a restart loop, so check `BLOCKED_DATES`
  before you upgrade.

## [0.5.0] - 2026-09-25

### Added

- `/embed?theme=dark|light` forces the embed's theme instead of following the
  visitor's own OS (an iframe's `prefers-color-scheme` never saw the host page's
  theme), and every page `/embed` renders now posts its actual content height to
  the parent via `postMessage`, growing or shrinking as the flow's content does,
  so the frame can be sized to fit instead of carrying a fixed height that clips
  a step or leaves an empty band under a shorter one (#44).
- The Docker Hub page for `antonshubin/mig` now has an overview; each release
  copies `docs/dockerhub.md` there (#49).

### Changed

- Slot buttons in the time grid show only the time; the timezone (city and UTC
  offset) appears once, above the grid, instead of repeating on every slot
  (#48).

## [0.4.1] - 2026-09-24

### Added

- The README shows screenshots of the booking page and of the `/embed` variant
  (#45).

### Fixed

- The `HIDE_BRANDING` startup error now lists the accepted values instead of
  just saying "has an invalid value" (#42).

## [0.4.0] - 2026-09-24

**If you run mig from `antonshubin/mig:latest` under Watchtower or any other
auto-updater, it will pull this version on its own — and the effect depends on
your old setup.** On the old README's `docker run` command or Docker Compose
snippet, 0.4.0 keeps saving bookings fine, but every re-create loses them —
including the auto-updater's own. (The same is true for `compose.example.yml`
without `DATA_PATH` set, and for any named-volume variant of these setups —
covered by the same rescue steps below.) Your `CANCEL_SECRET` is safer than
that: it's lost the moment you `docker rm` the container yourself, whatever you
run afterwards — capture it with the `docker inspect` line in the rescue steps
below before you get there. Watchtower's own re-create never leaves that gap: it
copies the environment forward into the new container in the same step, so the
secret survives untouched. If your updater has already re-created the container,
that `docker inspect` line still recovers the secret from the container that's
running now; **do the rescue steps below before you pin or redeploy anything.**
On the old `compose.example.yml` with `DATA_PATH` set (bookings on a root-owned
host mount), every booking instead fails outright with "We couldn't save your
booking", while `/health` keeps answering healthy — the container's log shows
`mig: persist FAILED`. Either way, pin your image to `v0.3.4`, or pause the
updater, until you've done the upgrade steps below.

### Changed

- **Breaking for existing bind mounts and named volumes.** The Docker image now
  runs as a non-root user (`deno`, uid/gid 1993) instead of root, matching what
  `SECURITY.md` already claimed. `/data` (the bookings directory) is created and
  owned by `deno` in the image, so a brand-new, empty Docker named volume
  mounted there inherits that ownership — but an existing bind mount or named
  volume, previously written to as root, is not automatically writable by uid
  1993 any more. See the upgrade note below.
- Env and booking validation now runs on arktype instead of zod. Visitors see
  the same accept/reject decisions and the same messages; the install is smaller
  (#36).

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
- **Check `.env` before upgrading if you set `HIDE_BRANDING`.** `HIDE_BRANDING`
  is now parsed as a real boolean: `true`/`1`/`yes` (case-insensitive, trimmed)
  hides the footer, `false`/`0`/`no`/empty/absent shows it. Previously the
  parser was `Boolean(value)`, so any non-empty string hid the footer — `true`
  correctly, but also `false`, `0`, and anything else, including
  `.env.example`'s own `HIDE_BRANDING=false`, which silently hid it for anyone
  who copied that file. A value outside that accepted list, such as `on` or
  `hide`, now stops startup with `HIDE_BRANDING: has an invalid value` instead
  of silently hiding the footer as before. See the upgrade note below (#40).

### Security

- No startup error prints the value it was given any more. Up to 0.3.4, a bad
  setting could echo its value into the container log, for example `THEME`,
  `HOST_TZ`, a `WEEKLY_AVAILABILITY` entry or a `BLOCKED_DATES` date. Errors now
  name the variable and the rule, plus the position of the bad entry for the two
  list settings: `HOST_NAME: is not set`,
  `HOST_TZ: is not a valid IANA time zone`,
  `WEEKLY_AVAILABILITY: entry 2: unknown day` (#36, #41).

**Upgrade note.** Changing only the image, without also changing your mount,
breaks bookings either way: it silently loses existing ones on the old
`docker run` command or Docker Compose snippet, or leaves new ones failing to
save on the `DATA_PATH` setup, with nothing lost there. Read the step for your
setup before redeploying.

**If you followed the README's `docker run` command or its Docker Compose
snippet, or `compose.example.yml` with no `DATA_PATH` in your `.env` — whether
the mount was a host directory or a named volume:** your bookings only ever
lived inside the old container, at `/data/bookings.json` — the `/app/data`
mount, host directory or named volume alike, was never read from. Without
`DATA_PATH` set, the image's own `ENV DATA_PATH=/data/bookings.json` (unchanged
by this release) applies the same way regardless of which of these you followed.
Rescue them first, before you touch the mount or recreate the container:

```bash
docker stop mig &&
docker inspect mig --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^CANCEL_SECRET=' &&
docker cp mig:/data/bookings.json . &&
docker rm mig &&
sudo mv bookings.json ./data/bookings.json &&
sudo chown -R 1993:1993 ./data
```

Chained with `&&` on purpose: if any step fails — most importantly `docker cp`,
which would otherwise still be followed by `docker rm` destroying the only copy
of the bookings — the rest doesn't run.

If your mount was a named volume (`<volume>:/app/data`) rather than a host
directory, you have no `./data` to move the retrieved file into or `chown`
directly, and a helper container that bind-mounts your current directory to hand
the file over can fail with "Permission denied" on an SELinux-enforcing host,
since that mount carries no SELinux label. Use this complete block instead of
the one above — it pipes the file in over standard input instead:

```bash
docker stop mig &&
docker inspect mig --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^CANCEL_SECRET=' &&
docker cp mig:/data/bookings.json . &&
docker rm mig &&
docker run --rm -i -v <volume>:/data alpine \
  sh -c 'cat > /data/bookings.json && chown -R 1993:1993 /data' < bookings.json
```

Replace `<volume>` with your volume's name, then follow "Everyone: change the
mount" below, pointing the mount at `<volume>:/data`.

`docker cp` can't write straight into `./data` — Docker auto-created that
directory owned by root when the old container first started, since the old
instructions never had you create it yourself. Copy to the current directory
first, then move it in. `docker rm mig` clears the stopped container so the next
`docker run --name mig ...` (or `docker compose up`) doesn't fail with "name
already in use" — but it also destroys the only copy of the old container's
`CANCEL_SECRET`, unless you kept the file it came from. The old README's
`docker run` command generated it inline with `$(openssl rand -base64 32)` and
never wrote it anywhere else, so for that setup the `docker inspect` line above
is the only way to recover it. The old Docker Compose snippet instead wrote it
in plain text into `compose.yml` itself — check that file first; only rely on
`docker inspect` if it's gone too. Use only the part after `CANCEL_SECRET=` as
the value — the printed line starts with `CANCEL_SECRET=` itself, so pasting the
whole thing gives you `CANCEL_SECRET=CANCEL_SECRET=...`. Put that value in place
of `$(openssl rand -base64 32)` when you redeploy, so cancel links already sent
by email keep working.

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

**If your `.env` sets `HIDE_BRANDING`:** `false` (or `0`/`no`/empty) now
correctly shows the footer again — if you copied `.env.example`'s old
`HIDE_BRANDING=false`, expect it back; that's the fix above, not a regression.
Any value other than `true`/`1`/`yes`/`false`/`0`/`no`/empty now stops the
container at startup, so check `.env` before upgrading.

## [0.3.4] - 2026-09-24

### Fixed

- The date note on a hovered time slot now meets 4.5:1 contrast in the light
  theme (#37).

## [0.3.3] - 2026-09-24

### Fixed

- Almost all text now meets the 4.5:1 minimum contrast in both themes: the
  Confirm button and step badges, secondary text, the footer, form placeholders,
  the Cancel button and the 500-page label (#34).

## [0.3.2] - 2026-09-23

### Fixed

- The owner's calendar invite now shows the visitor's clock alongside the
  host's, matching the owner email (#26).
- A failed booking email no longer tells the visitor their own email failed; it
  now says the booking wasn't created (#26).
- The rollback-failure log no longer says no email was sent when the owner's
  email actually went out (#26).
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

[Unreleased]: https://github.com/spy4x/mig/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/spy4x/mig/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/spy4x/mig/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/spy4x/mig/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/spy4x/mig/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/spy4x/mig/compare/v0.3.4...v0.4.0
[0.3.4]: https://github.com/spy4x/mig/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/spy4x/mig/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/spy4x/mig/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/spy4x/mig/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/spy4x/mig/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/spy4x/mig/releases/tag/v0.2.0
