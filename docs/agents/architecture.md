# Architecture map

Where each part of webedit lives, so you can read the one file you need instead of the whole tree. Every file opens with a comment saying what it owns. The terms are defined in `GLOSSARY.md`, and the decisions behind them are in `.scratch/webedit/spec.md` (run `grep -n '^#'` on it for the section list; it is 27k characters, so read only the sections you need).

## Request path

Browser → `web/src/api.ts` → `/api/*` handlers in `internal/server/` → the Dropbox **port** (`internal/dropbox/port.go`) → `client.go` (real Dropbox) or `fake.go` (tests and test mode).

## Go server

| File | Owns |
|---|---|
| `cmd/webedit/main.go` | Startup: config, the token store, the port (real or fake), the server |
| `internal/config/config.go` | Environment variables and their validation |
| `internal/server/server.go` | Routes, middleware, the one JSON error shape and `errorCodes`, `serveIndex` (CSP nonce) |
| `internal/server/files.go` | Tree, open and save handlers, and `dropboxError` (Dropbox error → API code) |
| `internal/server/manage.go` | Create, rename/move and delete |
| `internal/server/textfile.go` | Text File decode and encode: BOM, line endings, trailing newline |
| `internal/server/auth.go`, `signing.go`, `security.go` | Sign-in with Dropbox, signed cookies, CSP and the other security headers |
| `internal/server/paths.go` | Client path validation |
| `internal/dropbox/` | `port.go` (the interface and its errors), `client.go` (HTTP, retries, 401 handling), `fake.go` |
| `internal/tokenstore/store.go` | The encrypted refresh token on disk |

New API error codes go in the spec's closed list; `make docs-check` enforces it.

## Frontend (`web/src/`, Solid and CodeMirror 6)

| File | Owns |
|---|---|
| `appState.ts` | The App state: the tree, the open Tabs, the Preview Tab, Drafts in memory, open/save/refresh. The largest module (about 740 lines); grep it rather than reading it whole |
| `App.tsx` | Layout and wiring, and the check for outside changes when the window regains focus |
| `Editor.tsx` | The CodeMirror view per Tab. Every `EditorView` needs the CSP nonce extension in its initial state |
| `draftStore.ts` | Drafts and open Tabs in IndexedDB, plus the localStorage journal for a Draft typed just before the page is left |
| `commands.ts`, `appCommands.ts`, `fileActions.tsx` | The command registry, the app's commands and their shortcuts, and file management |
| `Finder.tsx`, `finders.tsx`, `fuzzy.ts`, `headings.ts` | Goto Anything, the Command Palette and Goto Heading |
| `Sidebar.tsx`, `TabBar.tsx`, `ConflictDialog.tsx`, `SignIn.tsx` | The file tree, the Tabs, the Save Conflict dialog, the sign-in page |
| `layout.ts`, `PhoneToolbar.tsx` | The phone layout: `phoneQuery`, the drawer, the toolbar |
| `sublimeKeymap.ts`, `indentation.ts`, `languages.ts`, `mariana.ts`, `settings.ts` | The editor's feel: keys, indentation, lazy-loaded languages, colours, settings |
| `paths.ts` | Path helpers. Dropbox paths are case-insensitive; compare them through these |

## Tests: three seams, nothing below them

- **Go HTTP tests** (`internal/server/*_test.go`): the in-process server against `fake.go`. `internal/dropbox/client_test.go` tests the real client against a stub HTTP server.
- **Binary** (`cmd/webedit/main_test.go`): startup and configuration.
- **E2E** (`web/e2e/`): Playwright against the real binary in test mode. Read `web/e2e/README.md` before writing or running these tests.
