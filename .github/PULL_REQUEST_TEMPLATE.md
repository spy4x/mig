---
name: Pull request
about: Submit a change
---

## Summary

<!-- One paragraph: what's changing and why? -->

## Linked issues

<!-- Closes #N, fixes #N, refs #N — full URLs please -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds behaviour)
- [ ] Breaking change (existing behaviour changes)
- [ ] Refactor (no behaviour change)
- [ ] Documentation (no code change)
- [ ] CI / tooling

## Checklist

- [ ] `deno task check` passes locally (lint + format + type-check)
- [ ] `deno test -A` passes
- [ ] New behaviour has tests
- [ ] Docs updated if user-facing (`README.md`, `CHANGELOG.md`, `docs/`,
      `.env.example`)
- [ ] No new third-party deps without justification in the description
- [ ] Commit message follows Angular convention (`feat(scope): ...`)

## Test plan

<!-- How did you verify it works? -->
