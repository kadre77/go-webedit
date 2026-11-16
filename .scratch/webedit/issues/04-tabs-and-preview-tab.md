# 04: Tabs and Preview Tab

**What to build:** The Owner can have several Text Files open as Tabs and works with them the way Sublime does: a single click opens a Preview Tab that the next single click replaces; editing or double-clicking pins it as a normal Tab. Sublime shortcuts switch and close Tabs, and the active file is highlighted in the sidebar tree. See `../spec.md` (Frontend: workspace state) and user stories 23–29.

**Blocked by:** 02 (Browse the Root Folder read-only)

**Status:** ready-for-agent

- [ ] Workspace state tracks open Tabs, the active Tab and which Tab (if any) is the Preview Tab
- [ ] Single click opens a file in the Preview Tab, replacing any existing Preview Tab; opening a file that is already open just activates its Tab
- [ ] Double-clicking the file or the Tab, or editing its content, pins the Preview Tab as a normal Tab
- [ ] Ctrl+W closes, Ctrl+Tab / Ctrl+PageUp / Ctrl+PageDown switch, Alt+1..9 jumps to a Tab (Cmd instead of Ctrl on macOS)
- [ ] The active Tab's file is highlighted in the sidebar tree, and its folders expand to reveal it
- [ ] Each Tab keeps its own editor state (cursor, scroll, undo history) while switching
- [ ] Playwright tests cover preview replacement, pinning by edit and by double-click, and the shortcuts
