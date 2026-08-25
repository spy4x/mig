# Contributing

Thanks for your interest in mig! Contributions welcome.

## Ground rules

- **Keep it small.** mig is intentionally minimal. PRs that add features outside
  the spec ("what about recurring bookings?", "can it sync with Google
  Calendar?") will be rejected. See [README.md](README.md) for the explicit
  "don't use it if" list.
- **Don't add dependencies.** Each new `jsr:` or `npm:` package needs a
  justification in the PR description. The existing budget:
  - `fresh` (Fresh framework)
  - `preact` (UI rendering)
  - `@preact/signals` (theme toggle state)
  - `tailwindcss` (utility classes)
  - `@tailwindcss/vite` (Vite plugin)
  - `vite` (build tool)
  - `denomailer` (SMTP)
  - `zod` (validation)
  - `@std/ulid` (IDs)
  - `@fresh/plugin-vite` (Vite integration)
- **One logical change per commit.** Angular commit convention
  (`feat(scope): ...`, `fix(scope): ...`).
- **Run `deno task check` before committing.** Lint, format, and type-check must
  pass.
- **Run `deno test -A`.** All tests must pass.
- **Add tests for new behaviour.** Bug fixes too.

## Development setup

```bash
git clone https://github.com/spy4x/mig.git
cd mig
cp .env.example .env  # then edit
deno task dev         # vite dev server at localhost:5173
```

## Project layout

See [AGENTS.md](AGENTS.md) for the architectural overview, invariants, and
conventions.

## Testing

- Unit tests in `*.test.ts` next to the file under test
- `deno test -A` runs everything
- `lib/availability.test.ts`, `lib/bookings.test.ts`, `lib/ics.test.ts`,
  `lib/ratelimit.test.ts`, `lib/tokens.test.ts` are the starting points.

## Pull request flow

1. Branch off `main` (`feat/short-kebab-description`).
2. Implement + commit + push.
3. Open PR with `--fill` (`gh pr create --fill`). Prefix title with `[WIP]` if
   not ready.
4. CI runs lint + type-check + test + build.
5. Wait for review.
6. Merge protocol: human-in-the-loop. **Never merge your own PR.** Squash or
   rebase per maintainer instruction.

## Reporting issues

- **Bugs:** use the bug report template. Include mig version, deno version, OS,
  and a minimal reproduction.
- **Security:** see [SECURITY.md](SECURITY.md) — don't open a public issue.
- **Feature requests:** keep them small. "I want a UI to view all bookings" is
  fine. "I want Zapier integration" is not.
