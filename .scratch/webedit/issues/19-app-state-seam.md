# 19: Give the App state a seam for its adapters

**Status:** done

**What's wrong:** `createAppState()` (`web/src/appState.ts`) creates and calls its own dependencies. It calls `createDraftStore()` itself (IndexedDB and localStorage), calls the `api` object from `api.ts` directly (9 methods), and uses the browser's `confirm` for "Discard your Draft?". The frontend has no tests except e2e, so the App state's ordering rules can only be checked through Playwright. The e2e tests fake the races with `page.route` delays, and some of the `checkTab` stale-answer guards are not tested at all.

**Decisions** (from the architecture review of 2026-11-19, candidate 1):

1. **Interface.** `api.ts` exports `RootFolderApi`: only the calls `appState` makes (open, save, check, save copy, tree, create file, create folder, move, delete). The `api` object is typed against it. `createAppState({ api, drafts, confirm })` takes all three, none optional. `App.tsx` passes the real `api`, `createDraftStore()` and `window.confirm`. A required argument means a test that leaves one out fails to compile instead of quietly using IndexedDB or the network.
2. **Test versions** live in `web/src/testing/`. Only test files import from there.
   - An in-memory `RootFolderApi` that behaves like Dropbox: revisions, `ApiError` `conflict` carrying the current revision, `not-found`, `already-exists`, case-insensitive paths (compare through `paths.ts`). Errors use codes from the existing `ErrorCode` list.
   - A test can hold any call open and release it later, to set up races.
   - A memory `DraftStore`.
3. **Time.** `setTimeout` stays as it is. Tests use vitest fake timers. Nothing is passed in for time.
4. **Runner.** Add vitest and `vite-plugin-solid` (Node environment, no DOM) as `test:web`. Run it from `make check-fast`, so the pre-commit hook covers it. Add it to `docs/agents/architecture.md` as a fourth test seam.
   - Setup detail: Solid normally resolves to its server build under Node, where signals don't react. Point vitest at the browser build (resolve conditions).
   - Run the state inside `createRoot`.
5. **First tests.** Only the ordering rules that are hard or impossible to reach from e2e:
   - an earlier open that answers late is dropped (`latestOpen`);
   - a double click fetches once (`pending`);
   - `checkTab`'s stale-answer guards, including a save that finished while the check was running;
   - a second save waits for the first (`saving`);
   - Tabs opened while `restore()` runs are kept.
6. **Replace, don't layer.** Remove the `page.route` race tests that a vitest test now covers: `tabs.spec.ts` (around line 205), `save.spec.ts` (around line 100), `drafts.spec.ts` (around line 164). First read each one, to confirm it checks nothing the vitest test doesn't. Each spec keeps a plain test that the real wiring works. `auth.spec.ts:46` stays: sign-out on a lost session is wired in `api.ts`, not `appState`.

**Left out on purpose:**
- Preview Tab and Tab identity. A later Tab set refactor (review candidate 2) will reshape them, so test them then.
- Checking the fakes against the real server (review candidate 5).
- The localStorage leaving journal, which stays inside `draftStore.ts` and stays covered by e2e.

**Done when:** `make check` passes, `test:web` runs in `check-fast`, the tests above are in vitest, the e2e race tests they replace are gone, and `architecture.md` lists the fourth test seam.

## Comments

- 2026-11-19: Decided in an architecture review grilling session. No glossary or ADR changes.
- 2026-11-19: Done. Where it differs from the plan:
  - Only `tabs.spec.ts` "the last file clicked wins the Preview Tab" was a race, and it moved to vitest. `save.spec.ts` "a failed save keeps the Draft" and `drafts.spec.ts` "a restored Draft is kept when Dropbox can't be reached" use `page.route` to simulate failures, not races. They also cover the real IndexedDB reload, so they stay.
  - No resolve conditions were needed: under vitest, `vite-plugin-solid` already resolves Solid to its browser build.
  - Each guard was checked by removing it and seeing a test fail: `latestOpen`, `pending`, the `saving` guard in save and in the check, the check's stale-revision, closed-Tab and typed-meanwhile guards, keeping Tabs opened during restore, and the `restored` gate on storing the open Tabs.
