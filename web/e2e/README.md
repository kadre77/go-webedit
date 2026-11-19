# E2E tests

Playwright drives the real binary in test mode (`serve.sh`): a fake, in-memory Dropbox seeded from `fixtures/`, and sign-in through `/auth/signin` that approves at once. Every test runs twice, in the `desktop` and `phone` projects.

## Running

- **Whole suite:** `make test-e2e` (about 3.5 minutes). Run it once at the end, not as the first check.
- **One spec while working:** from `web/`, `corepack pnpm exec playwright test tabs --project=desktop -x`. `serve.sh` rebuilds the frontend when `src/` is newer than `dist/`, so a bare `playwright test` never serves stale code.
- **After a layout change,** run `--project=phone -x` first: a hidden tree fails every test that touches it.
- **Server log:** `/tmp/webedit-e2e/server.log`. **Failure traces:** `test-results/`, opened with `corepack pnpm exec playwright show-trace <trace.zip>`.
- **Stray server:** `scripts/stop-server.sh` stops the one on port 18080. `pkill -f bin/webedit` kills the shell that runs it.
- **Workers:** this machine has 2 cores. Leave `--workers` at the default; more workers only produce timeouts.
- **`--repeat-each`** is unsafe: the fake Dropbox keeps its state between repeats, so tests that change a fixture fail on the second pass. To chase a flake, rerun one test in a loop with a fresh server each time.

## Fixtures

- The fake Dropbox is shared by all workers and both projects. A test that changes a file gets its own: `fixtures/<Area>/desktop-<case>.md` and `phone-<case>.md`, picked by project name. Adding a file to a folder the tree tests list changes what they see.
- `fixtures/readme.md` is a fixture, not documentation. Fixtures with code extensions need to keep Go's tools away: `Code/main.go` starts with `//go:build ignore`, so `head` a fixture before asserting on its text.
- Simulate a change made elsewhere with the test-mode hook `PUT /api/test/file` (`DELETE` removes one), sending an `Origin` header (see `conflicts.spec.ts`).

## Writing tests

- **Locators:** use roles and accessible names (`getByRole("textbox", { name: "Go to line:" })`), the way the specs already do. CSS classes from CodeMirror change.
- **Phone vs desktop:** use the helpers in `ui.ts` (`showTree`, `clickItem`, `longPress`, `swipe`), which open the drawer on the phone. Skip with `test.skip(({ isMobile }) => ..., "reason")` only for features the layout doesn't have.
- **Closing a Tab:** use its close button, `getByRole("button", { name: "Close readme.md" })`. Middle-click isn't supported.
- **Keys:** `press("Shift+d")` types `d`; write the letter in upper case (`Shift+D`). Synthetic key presses get through even when a real browser keeps the key for itself, so a passing test doesn't prove that a shortcut works.
- **Text:** `toHaveText` collapses whitespace, so check indentation against the exact `textContent`.
