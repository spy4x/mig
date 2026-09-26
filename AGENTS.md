# AGENTS.md — mig

## Stack

- **Language:** TypeScript on Deno 2.x
- **Framework:** [Fresh 2](https://fresh.deno.dev/) (Preact + JSX, islands
  architecture)
- **Styling:** Tailwind CSS v4 (utility classes only — no custom CSS files)
- **Container:** Debian-based, two-stage build (`denoland/deno:debian-2.9.5` for
  both stages — the alpine variant's musl libc can't load `@tailwindcss/oxide`'s
  native binding). The build stage runs `deno install --frozen` then
  `deno task build` (Vite) to produce `_fresh/`, no Node.js or npm involved; the
  runtime stage copies only `_fresh/` and `static/` and serves them with
  `deno serve -A --port=${PORT} _fresh/server.js` — not the `deno compile`
  binary from `deno task compile`, which is a separate, unused-in-prod option.
  The runtime stage runs as `deno` (uid/gid 1993, already created by the base
  image), not root; `/data` (`DATA_PATH`'s parent dir) is created and chowned to
  `deno` before `USER deno`, so a _new_, empty Docker named volume mounted there
  inherits that ownership. A named volume mig already wrote to under an older,
  root-run image stays owned by root — see CHANGELOG's upgrade note. A host bind
  mount needs to be writable by uid 1993 itself — see README's Docker quick
  start.
- **CI:** Woodpecker `check` step — `deno install --frozen`, `deno task check`
  (fmt --check + lint + type check), `deno task test`, `deno task build` — on
  every push, pull request, tag and manual run; a tag-only `release` step then
  builds and publishes the Docker image.
- **Storage:** JSON file (`./data/bookings.json`) + in-process async mutex
- **Email:** SMTP via `@spy4x/email` (`nodemailer` underneath, pinned by that
  package)
- **IDs:** ULID (Crockford base32, time-sortable), from `@spy4x/platform/tokens`

## Invariants

- **One owner, no auth.** Single-tenant by design — owner is defined by env vars
  (`HOST_NAME`, `HOST_EMAIL`). No login, no admin UI, no DB.
- **Configuration is code.** All booking behaviour (working hours, blocked
  dates, slot duration, notice horizon, meeting URL, SMTP creds) lives in
  environment variables. Changing behaviour = restarting the container.
- **Stateless cancel tokens.** A booking stores
  `sha256(raw token + CANCEL_SECRET)` (`@spy4x/platform/tokens`); the raw token
  goes only in the email. `CANCEL_SECRET` needs at least 32 printable ASCII
  characters. No per-booking revoke — rotate `CANCEL_SECRET` to invalidate all.
- **No background jobs.** Everything is request/response. No cron, no reminder
  worker. v1 has no reminder emails.
- **Single instance only.** In-memory mutex serialises writes within the
  process. Multi-replica deployment is out of scope.

## Architecture

```
src/
├── main.ts                  — production entry (deno serve)
├── dev.ts                   — dev entry (vite)
├── binary.ts                — `deno task compile` entry, serves the embedded _fresh/
├── deno.json                — Fresh imports, tasks, lint config
├── routes/
│   ├── _app.tsx             — HTML shell, theme bootstrap
│   ├── _404.tsx             — not found
│   ├── _500.tsx             — error
│   ├── index.tsx            — standalone booking page
│   ├── confirmed.tsx        — standalone confirmation / cancelled page
│   ├── cancel.tsx           — GET form + POST action
│   ├── embed/
│   │   ├── index.tsx        — /embed iframe variant (no islands, self-contained)
│   │   ├── confirmed.tsx    — /embed/confirmed, no Header/Footer/ThemeToggle
│   │   └── book.ts          — POST /embed/book, redirects stay under /embed
│   └── api/
│       ├── book.ts          — POST /api/book (standalone; shares lib/book.ts)
│       └── slots.ts         — GET slots for a date (JSON)
├── islands/
│   ├── DatePicker.tsx       — client interactive
│   ├── SlotPicker.tsx
│   ├── BookingForm.tsx
│   └── ThemeToggle.tsx
├── lib/
│   ├── config.ts            — env parsing + arktype validation
│   ├── config-issue.ts      — formats one startup error line, never the value
│   ├── availability.ts      — weekly pattern + blocked-dates parser
│   ├── bookings.ts          — JSON store (mutex + atomic write: @spy4x/platform)
│   ├── email.ts             — email content; sending via @spy4x/email
│   ├── notify.ts            — ntfy pushes (client: @spy4x/integrations), NTFY_MODE
│   ├── email-pattern.ts     — zod 3.25.76's email regex, copied verbatim
│   ├── invite.ts            — booking → .ics invite (writer: @spy4x/time/ics)
│   ├── clock.ts             — mig's zone labels + canonical zone names
│   ├── validators.ts        — shared arktype schema for booking submission
│   ├── book.ts              — POST /api/book + POST /embed/book handler
│   ├── confirmed-data.ts    — shared /confirmed + /embed/confirmed lookup
│   ├── picker-links.ts      — basePath-aware href builder for the picker
│   ├── guest-tz-script.ts   — inline timezone-capture script for /embed's form
│   ├── theme.ts             — theme bootstrap script + /embed's ?theme= parser
│   └── height-report-script.ts — /embed's postMessage height-reporting script
├── components/              — server-side Preact components (no hydration)
├── scripts/screenshots.ts   — writes the README pictures (see "Screenshots")
└── data/.gitkeep            — runtime mount point
```

## Conventions

- **Idiomatic TypeScript:** `deno fmt` clean, `deno lint` clean, `deno check`
  clean. Never commit with failures.
- **Indent:** 2 spaces, double quotes, no semis, 100-col. Double quotes override
  the global "backticks for strings" rule; backticks only for interpolation.
- **IDs as strings** — never numbers.
- **Functional over OO.** Small pure functions; class only when state genuinely
  needs encapsulation (`AsyncMutex`, `BookingsStore`).
- **Errors as data** — return `{ ok: true, value } | { ok: false, error }` for
  expected failure modes (validation, conflict). `throw` only for programmer
  errors and truly exceptional cases.
- **No third-party deps without justification.** `deno.json`'s imports are the
  budget: Fresh (`fresh`, `@fresh/plugin-vite`), Preact (`preact`,
  `preact-render-to-string`, `@preact/signals`), Tailwind (`tailwindcss`,
  `@tailwindcss/vite`), `vite`, `arktype`, `@std/assert`, and the owner's own
  shared libraries, pinned exactly: `@spy4x/time` (zone math, the `.ics`
  writer), `@spy4x/platform` (rate limiter, tokens, mutex, atomic JSON write,
  input predicates, `Result`), `@spy4x/email` (SMTP sender, HTML shell),
  `@spy4x/integrations` (ntfy client), `@spy4x/net` (bounded request body) and
  `@spy4x/preact-signals` (the theme store and its first-paint script). Before
  writing a helper, check whether one of those already has it. Anything else
  needs a comment.
- **One `@preact/signals`.** `@spy4x/preact-signals` imports
  `npm:@preact/signals@2.5.1` exactly. A second copy next to mig's own hooks
  into Preact twice and server rendering throws "Cycle detected", so `deno.json`
  maps that exact specifier to mig's `@preact/signals`. Bumping
  `@spy4x/preact-signals` means checking which version it now imports and moving
  that mapping with it.
- **Concurrency:** every mutation goes through `bookings.mutate()` which
  acquires the in-process mutex. Never read-then-write the JSON directly.

## Env vars

See `.env.example` for the full list. All vars validated at startup — the
process exits 1 if any required var is missing or malformed.

### Build version

`MIG_VERSION` is a single optional string rendered in the footer inline with the
"Powered by mig" attribution: `Powered by mig v0.2.0`. It's how the host (and a
fresh agent on support duty) confirms at a glance which build is live.

- **Source of truth:** `Deno.env.get("MIG_VERSION")` read by `lib/config.ts`.
- **Default:** `"dev"` so `deno task dev` shows `Powered by mig vdev` without
  needing any env wiring.
- **Container injection:** the `Dockerfile` declares an `ARG MIG_VERSION=dev`
  and exposes it via `ENV MIG_VERSION=${MIG_VERSION}`. Pass it at build time so
  each image carries its own identifier:

  ```bash
  docker build \
    --build-arg MIG_VERSION=$(git rev-parse --short HEAD) \
    -t mig:abc1234 .
  ```

  Semver is the recommended format (`0.2.0`, `1.0.0`) so the footer reads as
  `Powered by mig v0.2.0`. Short SHAs also work — they just read as
  `Powered by mig vabc1234`.

- **Footer:** `components/Footer.tsx` adds the `v` prefix at render time, so
  callers can pass either `0.2.0` or `v0.2.0`. Hidden when `HIDE_BRANDING=true`
  (the footer line is one unit — branding and version share the same hide flag
  now).

## Commands

```bash
deno task dev          # vite dev server, HMR
deno task build        # production build → _fresh/
deno task start        # serve the build
deno task check        # fmt + lint + type-check
deno task test         # unit tests
deno task compile      # build + deno compile (binary.ts) → ./mig
deno task smoke:binary # start ./mig and check it serves pages
```

## Screenshots

```bash
deno task build && deno task screenshots
```

`scripts/screenshots.ts` writes only the pictures in use: the README's two under
`docs/screenshots/` (the booking-flow GIF, shown first under the title, and the
confirmation email in a dark mail-client frame) and `docs/social-preview.png`,
which the owner uploads by hand in the GitHub repository settings. The social
preview's hero, the dark booking page, is taken into the throwaway directory,
not the repository. The pictures are placeholders only: "Jane Doe", example.com
addresses and Europe/Berlin, never real data, so rerunning the command is always
safe to commit. How the email's mail-client frame is built is in
`.claude/skills/email-screenshot-frame/SKILL.md`.

It serves the existing `_fresh/` build on a free port with a throwaway data file
and its own in-process SMTP sink, so the booking it makes succeeds and no mail
leaves the machine. Chromium maps `meet.example.com` to that server and every
other host name to nothing. Browser time zone and locale are fixed
(`Europe/Berlin`, `en-US`), never the machine's own; the picked date is the
first full weekday after today, so the dates in the pictures move with the day
the command runs. The booking-flow GIF is recorded in the dark theme, the
README's default; headless Chromium records no cursor, so the script draws its
own pointer into the page (`pointerScript`, re-run on every page load and
remembering its position in `sessionStorage`), glides it along eased paths and
shows a ripple on each click. The recording is trimmed to the first painted page
and encoded at a steady 20 fps. The GIF needs `ffmpeg` (otherwise it keeps the
WebM), and PNGs over 400 KB are quantised with ImageMagick when it is installed.

Playwright is pinned inside the script (`npm:playwright@1.63.0`), not in
`deno.json`'s imports: it is a dev-only tool outside the dependency budget. The
task runs with `--node-modules-dir=none --no-lock`, so neither `node_modules`
nor `deno.lock` changes. It launches Playwright 1.63.0's own Chromium build from
`~/.cache/ms-playwright`; install it once with
`deno run -A --node-modules-dir=none --no-lock npm:playwright@1.63.0 install chromium`
(Chromium 1243 plus Playwright's ffmpeg for the video) if it is missing.

## CI

Woodpecker pipeline (`.woodpecker.yml`) on `denoland/deno:debian-2.9.5`
(matching the Dockerfile's build stage — the alpine variant's musl libc can't
load `@tailwindcss/oxide`'s native binding, so `deno task build` fails under
it). `nodeModulesDir` is `"manual"` in `deno.json`, so `deno install` must run
before any task that touches TypeScript or builds: the `check` step runs it
right after `deno --version`. The step calls the manifest's tasks instead of
repeating their commands, so the pipeline can't drift from `deno task check`:

- `deno install --frozen`
- `deno task check` (fmt --check + lint + type check)
- `deno task test`
- `deno task build`
- `deno task compile` + `deno task smoke:binary` (the standalone binary starts
  and serves pages)

`check` runs on push, pull request, tag and `manual` events, so it can also be
started by hand from the Woodpecker UI.

`deno install` always runs with `--frozen`: without it, a `deno.lock` that no
longer matches `deno.json` is silently rewritten instead of failing the build.

**The Dockerfile's build stage honours `deno.lock` the same way.** It keeps
`deno.lock` in the build context and runs `deno install --frozen` before
`deno task build`, in the same image as CI, with no Node.js or npm. So the
published image carries exactly the versions CI tested. An earlier build stage
ran its own `npm install` by `^` range and shipped a different `@preact/signals`
than the lock recorded; never reintroduce a separate install. `.dockerignore`
keeps a host `node_modules` out of the build context, because
`deno install --frozen` builds its own there.

`release` runs after `check` on a `v<digit>` tag and publishes `antonshubin/mig`
to Docker Hub: `v1.2.3` and `latest`, built with `MIG_VERSION=1.2.3`. A
pre-release tag such as `v1.2.3-rc.1` is published under its own name and never
moves `latest`. The step uses the agent's Docker daemon through its socket, so
the repository must stay trusted for volumes in Woodpecker. It logs in with
mig's repository secrets `DOCKER_USERNAME` and `DOCKER_PASSWORD`, enabled for
the tag event only. Never make them global: a global secret reaches every
repository on the Woodpecker server.

- `latest` follows the most recently pushed release tag, not the highest
  version. Never push or re-run an older release tag; tag a backport as a
  pre-release (`v1.2.4-rc.1`) instead.
- Trusted volumes also apply to pull requests from forks, and a step that mounts
  the Docker socket is root on the agent host. Approving a fork pull request
  that touches `.woodpecker.yml` hands out that access: read the diff first.

`dockerhub-overview` runs after `release` on the same tags and copies
`docs/dockerhub.md` into the image's Docker Hub overview, logging in with the
same two secrets. The overview is a separate file, not the README, because the
README's relative links and images break on Docker Hub. The step is fail-open:
if Docker Hub refuses (for example, an access token without the "Read, Write,
Delete" scope the overview needs), it prints
`warning: Docker Hub overview not updated` and the release still passes. After a
release, check `https://hub.docker.com/v2/repositories/antonshubin/mig/`'s
`full_description` to confirm it took.

Woodpecker substitutes `${VAR}` in the whole file before it parses the YAML,
including steps that will not run. An empty variable can turn a command into
invalid YAML: `mig:${CI_COMMIT_TAG} -t` became `mig: -t`, which YAML reads as a
map. Write a variable the shell should expand at run time as `$${VAR}`.

## Hard rules

- **NEVER commit plaintext secrets.** `.env` is gitignored.
- **NEVER hardcode real domains, emails, or hosts.** Templates only.
- **Single-process assumption.** No multi-instance; do not add distributed locks
  or external stores.
- **No background jobs in v1.** Reminders come later, if ever.

## Shared libraries

Before writing a component, helper or library here, search
[spy4x/ts-libs](https://github.com/spy4x/ts-libs) and
[spy4x/preact-components](https://github.com/spy4x/preact-components) for it.
The global rule
["Shared libs before local code"](https://github.com/spy4x/dotfiles/blob/main/ai-harnesses/AGENTS.md)
says what belongs in each library; code only this repo needs stays here.
