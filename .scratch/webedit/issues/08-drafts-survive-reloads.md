# 08: Drafts survive reloads

**What to build:** Unsaved work is never lost to a reload, crash or closed browser tab. Drafts are written to browser storage as the Owner types, and open Tabs and the active Tab are restored per browser when the app loads again. A restored Draft shows as modified, leaving the page with Drafts warns first, and the app still works if browser storage is unavailable. See `../spec.md` (Frontend: draft store) and user stories 30, 46–47, 52.

**Blocked by:** 06 (Save)

**Status:** done

- [x] Drafts persist in IndexedDB keyed by path, written as the Owner types (debounced), and removed on successful save or discard
- [x] The list of open Tabs (including which is the Preview Tab) and the active Tab persist and are restored on load
- [x] Reopening a file with a stored Draft restores the Draft over the downloaded content and shows the modified dot; the stored opened revision is kept so a changed file still causes a Save Conflict
- [x] A restored Tab whose file no longer exists in Dropbox keeps its Draft and tells the Owner the file is gone
- [x] Leaving the page with any Draft triggers the browser's leave-page warning
- [x] Every storage call is wrapped so that unavailable or failing storage degrades to in-memory only, without errors
- [x] Playwright tests: type, reload, Draft and Tabs restored; save, reload, no Draft
