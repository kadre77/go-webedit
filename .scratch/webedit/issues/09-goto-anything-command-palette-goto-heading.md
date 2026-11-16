# 09: Goto Anything, Command Palette and Ctrl+R

**What to build:** One shared fuzzy-finder overlay powers Goto Anything (Ctrl+P: open any Text File by typing part of its path, file-name matches first), the Command Palette (Ctrl+Shift+P: the app's commands with their shortcuts), and Ctrl+R (jump to a Markdown heading). Other tickets add their own commands to the palette through a small registry. See `../spec.md` (Frontend: Goto Anything and Command Palette, Goto heading) and user stories 20–22, 40, 59–60.

**Blocked by:** 04 (Tabs and Preview Tab)

**Status:** ready-for-agent

- [ ] A fuzzy-finder overlay driven by keyboard (type to filter, arrow keys to move, Enter to choose, Esc to close)
- [ ] Goto Anything searches every Text File path in the tree; a match in the file name ranks above a match spread across folders; Enter opens the file in a Tab
- [ ] A command registry: each command has a name, an optional shortcut and an action; the Command Palette lists registered commands with their shortcuts
- [ ] Existing commands are registered (close Tab, next/previous Tab, save, go to line, and anything else already built)
- [ ] Ctrl+R lists the active Markdown file's headings (from CodeMirror's Markdown syntax tree), indented by level, and jumps to the chosen one; for other languages it shows "no symbols"
- [ ] Playwright tests cover Goto Anything ranking and opening, running a command from the palette, and jumping to a heading
