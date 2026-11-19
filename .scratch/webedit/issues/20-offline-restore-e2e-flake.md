# 20: A tree that loads late hides the restore notice

**Status:** done

**What's wrong:** `web/e2e/drafts.spec.ts` "a restored Draft is kept when Dropbox can't be reached, and saves once it can" fails during `make test-e2e`, on the phone project, the desktop project or both. It passes when its spec runs alone (`playwright test drafts`, 16 of 16; the phone test alone passed 3 of 3).

The failure: after `page.reload()`, the Tab for `<project>-offline.md` is restored but no alert appears. The open seems to have succeeded even though `page.route("**/api/file?*")` answers 503. If the routed 503 had arrived, the Owner would see "Couldn't open …" (the Draft was stored) or "Dropbox is unavailable." (it wasn't).

**Seen on:** 2026-11-19, three full runs in a row: twice on the ticket 19 changes, and once on `5b01cc1` (before them) with those changes stashed. So ticket 19 didn't cause it.

**Cause (found 2026-11-19):** it's a race in the app; the test is right to fail. `App.tsx` starts `loadTree()` and `restore()` together. When the tree answers after `restore` has set "Couldn't open X …", `loadTree`'s `setError(undefined)` (`appState.ts`, in `loadTree`) wipes the notice. The trace shows the routed 503 did arrive, so the cache lead (ticket 18) was wrong. The routed 503 comes back instantly, but under full-suite load the real `/api/tree` is slower, so only the full suite shows it. A throwaway vitest test reproduced it: the notice stays if the tree answers first, and is gone if it answers last.

**Fix:**
- Test first in `appState.test.ts`: hold `tree`, run `restore` over a stored Draft whose open fails with `dropbox-unavailable`, release the tree, and expect the "Couldn't open" notice to remain. The `FakeRootFolder` will need a way to make `openFile` fail with a transient error.
- `loadTree` clears only an error it set itself.
- `openPath`, `move` and `remove` also clear any notice on success. They are the Owner's own actions, so leave them.
- Then `make check` should be green.

## Comments
- 2026-11-19: Fixed. `FakeRootFolder.fail()` makes a call fail. Two vitest tests: a late tree keeps the restore notice, and a tree that loads after failing clears its own failure. Each fails if `loadTree` goes back to clearing every notice or stops clearing its own. `make check` green: 12 vitest, 170 e2e.
