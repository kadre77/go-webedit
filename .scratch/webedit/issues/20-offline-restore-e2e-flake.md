# 20: The offline-restore e2e test fails in the full suite

**Status:** needs-triage

**What's wrong:** `web/e2e/drafts.spec.ts` "a restored Draft is kept when Dropbox can't be reached, and saves once it can" fails during `make test-e2e`, on the phone project, the desktop project or both. It passes when its spec runs alone (`playwright test drafts`, 16 of 16; the phone test alone passed 3 of 3).

The failure: after `page.reload()`, the Tab for `<project>-offline.md` is restored but no alert appears. The open seems to have succeeded even though `page.route("**/api/file?*")` answers 503. If the routed 503 had arrived, the Owner would see "Couldn't open …" (the Draft was stored) or "Dropbox is unavailable." (it wasn't).

**Seen on:** 2026-11-19, three full runs in a row: twice on the ticket 19 changes, and once on `5b01cc1` (before them) with those changes stashed. So ticket 19 didn't cause it.

**A lead, not checked:** `/api/file` responses carry no `Cache-Control` (ticket 18). If the browser answers the GET after the reload from its own cache, the route never sees it. That would also explain why it fails only under the load of the full suite. Check the trace in `test-results/drafts-a-restored-Draft-is-0ac17-*` for whether `/api/file` came from the cache.

## Comments
