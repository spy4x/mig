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
- **Email:** SMTP via `nodemailer`
- **IDs:** ULID (Crockford base32, time-sortable)

## Invariants

- **One owner, no auth.** Single-tenant by design — owner is defined by env vars
  (`HOST_NAME`, `HOST_EMAIL`). No login, no admin UI, no DB.
- **Configuration is code.** All booking behaviour (working hours, blocked
  dates, slot duration, notice horizon, meeting URL, SMTP creds) lives in
  environment variables. Changing behaviour = restarting the container.
- **Stateless cancel tokens.** Cancellation links carry a SHA-256 HMAC of a
  random token; the raw token goes only in the email. No per-booking revoke —
  rotate `CANCEL_SECRET` to invalidate all.
- **No background jobs.** Everything is request/response. No cron, no reminder
  worker. v1 has no reminder emails.
- **Single instance only.** In-memory mutex serialises writes within the
  process. Multi-replica deployment is out of scope.

## Architecture

```
src/
├── main.ts                  — production entry (deno serve)
├── dev.ts                   — dev entry (vite)
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
│   ├── bookings.ts          — JSON store + AsyncMutex
│   ├── tokens.ts            — ULID + HMAC sign/verify
│   ├── email.ts             — SMTP via nodemailer
│   ├── email-pattern.ts     — zod 3.25.76's email regex, copied verbatim
│   ├── ics.ts               — ICS VCALENDAR generator
│   ├── ratelimit.ts         — in-memory per-IP sliding window
│   ├── tz.ts                — IANA tz helpers
│   ├── validators.ts        — shared arktype schema for booking submission
│   ├── book.ts              — POST /api/book + POST /embed/book handler
│   ├── confirmed-data.ts    — shared /confirmed + /embed/confirmed lookup
│   ├── picker-links.ts      — basePath-aware href builder for the picker
│   └── guest-tz-script.ts   — inline timezone-capture script for /embed's form
├── components/              — server-side Preact components (no hydration)
└── data/.gitkeep            — runtime mount point
```

## Conventions

- **Idiomatic TypeScript:** `deno fmt` clean, `deno lint` clean, `deno check`
  clean. Never commit with failures.
- **Indent:** 2 spaces, double quotes, no semis, 100-col.
- **Money/IDs as strings** — never numbers.
- **Functional over OO.** Small pure functions; class only when state genuinely
  needs encapsulation (`AsyncMutex`, `BookingsStore`).
- **Errors as data** — return `{ ok: true, value } | { ok: false, error }` for
  expected failure modes (validation, conflict). `throw` only for programmer
  errors and truly exceptional cases.
- **No third-party deps without justification.** `deno.json`'s imports are the
  budget: Fresh (`fresh`, `@fresh/plugin-vite`), Preact (`preact`,
  `preact-render-to-string`, `@preact/signals`), Tailwind (`tailwindcss`,
  `@tailwindcss/vite`), `vite`, `nodemailer`, `arktype`, `@std/assert`,
  `@std/ulid`. Anything else needs a comment.
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
deno task compile      # deno compile → single binary
```

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

`check` runs on push, pull request, tag and `manual` events, so it can also be
started by hand from the Woodpecker UI.

`deno install` runs as `deno install --frozen`. Without `--frozen`, a
`deno.lock` that no longer matches `deno.json` gets silently rewritten instead
of failing the build, so a drifted lock could reach `main` unnoticed. Verified
in `denoland/deno:debian-2.9.5`, the step's own image: with the checked-in lock,
`deno --version`, `deno install --frozen`, `deno task check`, `deno task test`
and `deno task build` all pass, and `deno.lock` is byte-identical (`cmp`) before
and after; with `deno.json` given an import the lock has no entry for,
`deno install --frozen` alone exits non-zero and never reaches the later
commands.

**The Dockerfile's build stage honours `deno.lock` too**, the same way CI does.
It used to delete `deno.lock`, exclude it from the build context via
`.dockerignore`, and pull `vite`, `tailwindcss`, `preact`, `@preact/signals` and
`nodemailer` with a separate `npm install` by `^` range — so the published image
could carry different dependency versions than the ones CI tested and the lock
recorded — and it did: that path resolved `@preact/signals@2.11.2` where
`deno.lock` records `2.11.1`. Since CI's own `check` step already runs
`deno install --frozen` then `deno task build` inside the exact same
`denoland/deno:debian-2.9.5` image as the build stage, with no Node.js or npm,
the build stage now does the same: it keeps `deno.lock` in the build context and
runs `deno install --frozen` before `deno task build`, dropping the Node.js/npm
install and the npm-install workaround entirely. `deno install --frozen` builds
its own `/src/node_modules` (a `.deno/`-backed store) in the build stage — see
`.dockerignore`'s `node_modules` entry for why a host-managed one must still
stay out of the build context. Verified with a real `docker build` from a clean
`git archive` checkout (so a host `node_modules`/`_fresh` can't leak in, same
risk `.dockerignore` guards against): the build exits 0 with no Node.js or npm
installed anywhere in the image; the resolved `vite`, `preact`, `tailwindcss`
and `nodemailer` versions inside the build stage equal `deno.lock`'s recorded
versions exactly; a container from the built image answers `/`, `/embed` and
`/health` with 200, `/` is a full page (not the 77-byte empty-`<body>` failure
mode), and the footer shows the injected `MIG_VERSION`; and, with `deno.json`
given an import range the lock has no entry for, `docker build` fails at the
`deno install --frozen` step instead of silently building different versions
than CI tested, while an unchanged copy still builds. The runtime stage's layers
(base image, `_fresh/` + `static/` copy, env/healthcheck/CMD) are unchanged, so
the published image's own footprint doesn't change — the win is a build stage
that can no longer silently drift from what CI already tested, and a smaller,
faster one besides (no `apt-get install` of Node.js/npm and their several
hundred transitive dependencies, no separate npm resolution).

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
