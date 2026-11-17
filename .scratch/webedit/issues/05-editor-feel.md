# 05: Editor feel

**What to build:** Editing feels like the Owner's Sublime setup: the Mariana dark theme, syntax highlighting chosen by file extension and loaded on demand (Markdown first-class), indentation detected per file, and a Sublime-style keymap including multi-cursor, Ctrl+D, line operations, find/replace and go to line. See `../spec.md` (Frontend: editor view) and user stories 31–39, 41.

**Blocked by:** 02 (Browse the Root Folder read-only)

**Status:** ready-for-agent

- [x] CodeMirror 6 theme matching Sublime's Mariana dark colours for the editor chrome and syntax tokens, with Markdown tokens styled with care
- [x] Language picked from the file extension and loaded lazily for Markdown, JS/TS, JSON, HTML/CSS, Go, Python, YAML, Shell and SQL; anything else opens as plain text
- [x] Indentation (spaces vs tabs, and width) detected from file content
- [x] Sublime keymap written for the app: Ctrl+click adds a cursor, Ctrl+D selects the next occurrence, plus duplicate line, move line up/down, toggle comment, select line, split selection into lines and join lines (Cmd on macOS)
- [x] Find and replace in the current file (Ctrl+F, Ctrl+H) and go to line (Ctrl+G)
- [x] Language packs are loaded only when a file needs them, so the first page load doesn't pull in every language
- [x] Playwright tests (desktop) cover multi-cursor with Ctrl+D, a line operation, go to line, and Markdown highlighting being applied

## Comments

**2026-11-17 (agent):** Implemented. `mariana.ts` holds the theme: Mariana's colours for the editor chrome, the search and go-to-line panels, and the syntax tokens, with Markdown headings, emphasis, links, code and quotes each styled. `languages.ts` lists the languages as CodeMirror `LanguageDescription`s. Each one is a separate chunk, loaded the first time a file needs it. The same list serves Markdown's fenced code blocks, so they're highlighted lazily too. `indentation.ts` detects tabs vs spaces, and the space width from the commonest indentation step. `sublimeKeymap.ts` is the Sublime keymap; it takes precedence over CodeMirror's defaults. Tests are in `web/e2e/editor.spec.ts`. The new fixtures are in `web/e2e/fixtures/Code/`.

Decisions to note:
- A file with no indented lines uses 4 spaces. Ticket 11's settings will make this adjustable (`defaultIndentUnit`).
- Tab inserts the file's indent unit at each cursor, padding spaces to the next tab stop. With a selection, Tab indents the selected lines. Shift+Tab outdents.
- Bindings (Cmd for Ctrl on macOS): Ctrl+D, Alt+F3 (select all matches), Ctrl+L, Ctrl+Shift+L, Alt+Shift+Up/Down (add cursor; Ctrl+Shift on macOS), Ctrl+Shift+D, Ctrl+Shift+Up/Down (move line; Ctrl+Cmd on macOS), Ctrl+Shift+K (Ctrl on macOS too), Ctrl+J, Ctrl+Enter / Ctrl+Shift+Enter, Ctrl+/, Ctrl+Shift+/, Ctrl+] / Ctrl+[, Ctrl+M (Ctrl on macOS too), Ctrl+F, Ctrl+H (Cmd+Alt+F on macOS), F3 / Shift+F3, Ctrl+G (Ctrl on macOS too, as in Sublime). These bindings always prevent the browser's default, so Ctrl+D never opens the bookmark dialog.
- Brackets and quotes auto-close, matching brackets are highlighted, and code folds from the gutter, as in Sublime's defaults.
- The main bundle grew from about 306 kB to about 390 kB (about 101 kB to 125 kB gzipped). The growth comes from search, auto-closing brackets and CodeMirror's language core. No language pack is in it.
- The `main.go` fixture starts with `//go:build ignore`, so `go test ./...` and `go vet` skip it.
- On the emulated phone, a synthetic Enter is sometimes dropped by CodeMirror's Android input handling when the machine is busy. So the indentation test runs on desktop only.
- Alt+Shift+M switches Tab focus mode, so keyboard users can Tab out of the editor. Sublime's Ctrl+M (go to bracket) replaces CodeMirror's default binding for this.
- Tab with a selection inside one line replaces the selection with an indent, as Sublime does. A selection that spans lines is indented instead.
- File extensions are matched case-insensitively.
