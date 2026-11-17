# 09: Goto Anything, Command Palette and Ctrl+R

**What to build:** One shared fuzzy-finder overlay powers Goto Anything (Ctrl+P: open any Text File by typing part of its path, file-name matches first), the Command Palette (Ctrl+Shift+P: the app's commands with their shortcuts), and Ctrl+R (jump to a Markdown heading). Other tickets add their own commands to the palette through a small registry. See `../spec.md` (Frontend: Goto Anything and Command Palette, Goto heading) and user stories 20–22, 40, 59–60.

**Blocked by:** 04 (Tabs and Preview Tab)

**Status:** done

- [x] A fuzzy-finder overlay driven by keyboard (type to filter, arrow keys to move, Enter to choose, Esc to close)
- [x] Goto Anything searches every Text File path in the tree; a match in the file name ranks above a match spread across folders; Enter opens the file in a Tab
- [x] A command registry: each command has a name, an optional shortcut and an action; the Command Palette lists registered commands with their shortcuts
- [x] Existing commands are registered (close Tab, next/previous Tab, save, go to line, and anything else already built)
- [x] Ctrl+R lists the active Markdown file's headings (from CodeMirror's Markdown syntax tree), indented by level, and jumps to the chosen one; for other languages it shows "no symbols"
- [x] Playwright tests cover Goto Anything ranking and opening, running a command from the palette, and jumping to a heading

## Comments

**2026-11-17 (from ticket 07):** Register Refresh (`state.loadTree`, reloads the tree from Dropbox) as a command; for now it's only a sidebar button.

**2026-11-17 (implemented):** The registry is `web/src/commands.ts` (`commands.register({ name, shortcut, run })` returns an unregister function); the app's own commands are in `web/src/appCommands.ts`, which replaces `tabShortcuts.ts`. Shortcuts are written as "Mod+Shift+P" (Mod is Cmd on macOS) and the registry dispatches them page-wide, so Ctrl+G and Ctrl+F now work from outside the editor too. While a finder is open only the finder shortcuts work, and none while the Save Conflict dialog is open. Goto Anything opens the chosen file as a normal (pinned) Tab, not the Preview Tab. Refresh is registered as "Refresh File Tree". Phone toolbar buttons for Goto Anything and the Command Palette (ticket 12) can call `commands.list()` entries or open the finders the same way.
