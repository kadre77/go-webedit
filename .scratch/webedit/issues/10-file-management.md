# 10: File management

**What to build:** The Owner can create files and folders, rename or move them, and delete them from the sidebar's right-click menu and from the Command Palette. Collisions fail with a clear message, open Tabs and stored Drafts follow a rename, and delete asks first, closes the affected Tabs and relies on Dropbox's trash. See `../spec.md` (API contract: create, move, delete) and user stories 53–58.

**Blocked by:** 04 (Tabs and Preview Tab), 08 (Drafts survive reloads)

**Status:** ready-for-agent

- [ ] Create-file and create-folder APIs fail with `already-exists` when the path is taken (tested, including a case-only difference)
- [ ] Move API renames or moves files and folders and fails with `already-exists` on collision (tested)
- [ ] Delete API deletes a file or folder (tested)
- [ ] Real Dropbox adapter implements create file, create folder, move and delete
- [ ] Sidebar right-click menu offers new file, new folder, rename/move and delete; the same actions are registered in the Command Palette
- [ ] A new file opens in a Tab straight away
- [ ] Rename/move updates every open Tab and stored Draft under the old path, including files inside a moved folder
- [ ] Delete asks for confirmation, then closes the affected Tabs and drops their Drafts
- [ ] The tree updates after each action without a full Refresh
- [ ] Playwright tests cover create, rename with an open Tab that has a Draft, delete, and a collision error
