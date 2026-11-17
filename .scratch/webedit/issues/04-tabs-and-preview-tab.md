# 04: Tabs and Preview Tab

**What to build:** The Owner can have several Text Files open as Tabs and works with them the way Sublime does: a single click opens a Preview Tab that the next single click replaces; editing or double-clicking pins it as a normal Tab. Sublime shortcuts switch and close Tabs, and the active file is highlighted in the sidebar tree. See `../spec.md` (Frontend: app state) and user stories 23–29.

**Blocked by:** 02 (Browse the Root Folder read-only)

**Status:** done

- [x] App state tracks open Tabs, the active Tab and which Tab (if any) is the Preview Tab
- [x] Single click opens a file in the Preview Tab, replacing any existing Preview Tab; opening a file that is already open just activates its Tab
- [x] Double-clicking the file or the Tab, or editing its content, pins the Preview Tab as a normal Tab
- [x] Ctrl+W closes, Ctrl+Tab / Ctrl+PageUp / Ctrl+PageDown switch, Alt+1..9 jumps to a Tab (Cmd instead of Ctrl on macOS)
- [x] The active Tab's file is highlighted in the sidebar tree, and its folders expand to reveal it
- [x] Each Tab keeps its own editor state (cursor, scroll, undo history) while switching
- [x] Playwright tests cover preview replacement, pinning by edit and by double-click, and the shortcuts

## Comments

**2026-11-17 (agent):** Implemented. App state (`web/src/appState.ts`) holds the Tabs, the active Tab and the Preview Tab. `TabBar.tsx` shows the Tabs: the Preview Tab is in italics, double-clicking pins it, and each Tab has a close button. `tabShortcuts.ts` handles the shortcuts. One CodeMirror view is shared by every Tab. On a Tab switch, `Editor.tsx` swaps in that Tab's `EditorState` (content, cursor, undo history) and its scroll snapshot. Editing is now on (with undo history) so that an edit can pin the Preview Tab. Until ticket 06, edits live only in that per-Tab editor state. Tests are in `web/e2e/tabs.spec.ts`, desktop and phone.

Decisions to note:
- When several files are opened quickly, the last one asked for wins: a slower, earlier fetch is dropped.
- New Tabs go at the end. A new Preview Tab takes the old Preview Tab's place.
- Closing the active Tab activates the Tab to its right, or else the one to its left.
- Ctrl+Shift+Tab cycles backwards.
- Ctrl+Tab stays Ctrl on macOS, because Cmd+Tab belongs to the system.
- The tree expands to the active file only when the active Tab changes, so the Owner can still collapse its folders afterwards.
- On Android, `setState` left typing at the previous Tab's cursor position, so the editor dispatches the selection again after a switch.

**Open question for the Owner:** in an ordinary Chrome tab, the browser keeps Ctrl+W, Ctrl+Tab and Ctrl+PageUp/PageDown for itself, and on Linux it also keeps Alt+1..9. These shortcuts only reach the app where the browser passes them through, for example an installed app (PWA) window. Playwright's synthetic key presses get through, which is why the tests pass. Options: make the app installable as a PWA, or add alternative bindings.
