## Checks

`make check` (fmt, glossary and error-code checks, vet, tsc, Go tests, vitest, e2e) must pass before committing app code. The pre-commit hook runs `make check-fast`; run `make hooks` once per clone to enable it. Use `corepack pnpm`, never bare `pnpm`.

## Navigation

Which file owns what, and the test seams: `docs/agents/architecture.md`. Before running or writing e2e tests, read `web/e2e/README.md`.

## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as `Status:` lines in issue files. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
