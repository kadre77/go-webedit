# 07: Save Conflicts and outside changes

**What to build:** When a file changed in Dropbox after the Owner opened it, a save raises a Save Conflict dialog with three choices: overwrite with mine, reload theirs, or save mine as a copy. Tabs check for outside changes when the window regains focus: unmodified Tabs reload quietly, and Tabs with a Draft show a notice and keep the Draft. A Refresh command reloads the tree. See `../spec.md` (API contract: check file, save as copy; Frontend: outside-change rules) and user stories 19, 44–45, 48–50.

**Blocked by:** 06 (Save)

**Status:** ready-for-agent

- [ ] Check-file API returns a file's current revision
- [ ] Save-as-copy API writes to a sibling path with a "conflicted copy" suffix and timestamp, made unique if the name exists, and returns the new path and revision (tested, including a name collision)
- [ ] Save Conflict dialog: "overwrite" saves against the current revision, "reload theirs" replaces the Draft with Dropbox's content, "save as copy" writes the copy and opens it in a Tab while leaving the original untouched
- [ ] On window focus, each open Tab's revision is checked: unchanged does nothing, changed with no Draft reloads quietly, changed with a Draft shows a notice and keeps the Draft
- [ ] Refresh command reloads the tree from Dropbox
- [ ] A test-only hook in test mode lets Playwright change a file in the fake Dropbox mid-test
- [ ] Playwright tests cover each of the three conflict choices and both outside-change cases
