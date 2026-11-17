# 07: Save Conflicts and outside changes

**What to build:** When a file changed in Dropbox after the Owner opened it, a save raises a Save Conflict dialog with three choices: overwrite with mine, reload theirs, or save mine as a copy. Tabs check for outside changes when the window regains focus: unmodified Tabs reload quietly, and Tabs with a Draft show a notice and keep the Draft. A Refresh command reloads the tree. See `../spec.md` (API contract: check file, save as copy; Frontend: outside-change rules) and user stories 19, 44–45, 48–50.

**Blocked by:** 06 (Save)

**Status:** done

- [x] Check-file API returns a file's current revision
- [x] Save-as-copy API writes to a sibling path with a "conflicted copy" suffix and timestamp, made unique if the name exists, and returns the new path and revision (tested, including a name collision)
- [x] Save Conflict dialog: "overwrite" saves against the current revision, "reload theirs" replaces the Draft with Dropbox's content, "save as copy" writes the copy and opens it in a Tab while leaving the original untouched
- [x] On window focus, each open Tab's revision is checked: unchanged does nothing, changed with no Draft reloads quietly, changed with a Draft shows a notice and keeps the Draft
- [x] Refresh command reloads the tree from Dropbox
- [x] A test-only hook in test mode lets Playwright change a file in the fake Dropbox mid-test
- [x] Playwright tests cover each of the three conflict choices and both outside-change cases

## Comments

**2026-11-17 (implementation):** Check file is `GET /api/file/rev?path=`, and save as copy is `POST /api/file/copy` with `{path, content}`. The Dropbox port gained `Metadata`; the real adapter implements it with `get_metadata` and now also implements `UploadNew` (add mode), which the copy needs. A copy is named `<name> (conflicted copy YYYY-MM-DD HHMMSS)<ext>` in UTC, then `... HHMMSS 2)`, and so on. It takes the line endings and BOM of the original as Dropbox has it now. If the original is gone, over 5 MB, binary or now a folder, the content is written as sent, so the other version never blocks saving the Draft. After "save mine as a copy" opens the copy, the original Tab goes back to Dropbox's version, so the Draft lives only in the copy and the original Tab doesn't keep conflicting. The dialog also has Cancel (and Escape), which keeps the Draft. The outside-change check runs when the window regains focus or the browser tab becomes visible, as this ticket says. Story 48 ("when a Tab regains focus") could also mean switching Tabs inside the app, which doesn't trigger a check. Refresh is a sidebar button for now; ticket 09 should register it as a command. The test-mode hook is `PUT /api/test/file`, registered only when the server is given the fake (test mode).
