# 02: Browse the Root Folder read-only

**What to build:** In test mode, the Owner sees the whole Root Folder as a sidebar tree and can click a Text File to see its contents in a basic CodeMirror view. Behind that: the Dropbox port, an in-memory fake that behaves like Dropbox where the app depends on it (seeded from a fixture directory), server-side path cleaning, the tree API, and the open-file API with Text File / Binary File / 5 MB detection and line-ending detection. See `../spec.md` (Dropbox access, API contract, Line endings and encoding).

**Blocked by:** 01 (Walking skeleton)

**Status:** done

- [x] A Go Dropbox port interface covering the operations listed in the spec; the in-memory fake implements all of it
- [x] The fake has its own tests: the revision changes on every write, conditional uploads conflict on a revision mismatch, paths are case-insensitive but keep their display case, and create/move onto an existing path fails
- [x] Tree API returns every entry from one recursive listing, with path (display case), kind, size and an openable flag (too-large files are marked)
- [x] Open-file API returns LF content, revision, the detected line ending, a trailing-newline flag and BOM presence; it refuses files over 5 MB (`too-large`) and Binary Files (`binary-file`: not valid UTF-8, or containing a null byte)
- [x] Every client-supplied path is cleaned: `..`, encoded traversal, absolute paths, empty segments and control characters are rejected with `invalid-path` (HTTP-seam tests for each)
- [x] Errors use the single JSON error shape with a machine-readable code
- [x] Sidebar tree with expand/collapse; Binary Files and too-large files are visibly marked and don't open; a file found to be binary on open is marked as binary for the rest of the session
- [x] Clicking a Text File shows its content in CodeMirror (Playwright test against fixture files)

## Comments

**2026-11-17 (agent):** Implemented. `internal/dropbox` holds the port (`Port`), the in-memory `Fake` with its own tests, and a `NotConnected` stand-in used outside test mode until ticket 03 adds the real adapter. `GET /api/tree` and `GET /api/file?path=` are in `internal/server/files.go`, and path cleaning is in `paths.go`. Test mode seeds the fake from `WEBEDIT_TEST_FIXTURES`, which is refused outside test mode. Playwright uses `web/e2e/serve.sh`, which generates the over-5-MB and non-UTF-8 fixtures at startup. `Download` takes a size limit, so the real adapter can refuse large files without reading them. Decisions to note: the extra error code `not-a-file` (opening a folder). Segments that still decode to `.`/`..` or a separator after further percent-decoding are rejected, so files literally named like `%2e%2e` can't be opened. The tree API and file API are not yet behind a session (ticket 03).

**2026-11-17 (agent):** Owner decisions after review: the frontend module "Workspace state" is renamed "App state" (`web/src/appState.ts`), because the glossary avoids "Workspace". The strict percent-decoding path check stays and is recorded in the spec. `not-a-file` is kept, and the spec's error-code list is now complete rather than examples.
