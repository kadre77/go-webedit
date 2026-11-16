# 05: Editor feel

**What to build:** Editing feels like the Owner's Sublime setup: the Mariana dark theme, syntax highlighting chosen by file extension and loaded on demand (Markdown first-class), indentation detected per file, and a Sublime-style keymap including multi-cursor, Ctrl+D, line operations, find/replace and go to line. See `../spec.md` (Frontend: editor view) and user stories 31–39, 41.

**Blocked by:** 02 (Browse the Root Folder read-only)

**Status:** ready-for-agent

- [ ] CodeMirror 6 theme matching Sublime's Mariana dark colours for the editor chrome and syntax tokens, with Markdown tokens styled with care
- [ ] Language picked from the file extension and loaded lazily for Markdown, JS/TS, JSON, HTML/CSS, Go, Python, YAML, Shell and SQL; anything else opens as plain text
- [ ] Indentation (spaces vs tabs, and width) detected from file content
- [ ] Sublime keymap written for the app: Ctrl+click adds a cursor, Ctrl+D selects the next occurrence, plus duplicate line, move line up/down, toggle comment, select line, split selection into lines and join lines (Cmd on macOS)
- [ ] Find and replace in the current file (Ctrl+F, Ctrl+H) and go to line (Ctrl+G)
- [ ] Language packs are loaded only when a file needs them, so the first page load doesn't pull in every language
- [ ] Playwright tests (desktop) cover multi-cursor with Ctrl+D, a line operation, go to line, and Markdown highlighting being applied
