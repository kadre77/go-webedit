# 02: Browse the Root Folder read-only

**What to build:** In test mode, the Owner sees the whole Root Folder as a sidebar tree and can click a Text File to see its contents in a basic CodeMirror view. Behind that: the Dropbox port, an in-memory fake that behaves like Dropbox where the app depends on it (seeded from a fixture directory), server-side path cleaning, the tree API, and the open-file API with Text File / Binary File / 5 MB detection and line-ending detection. See `../spec.md` (Dropbox access, API contract, Line endings and encoding).

**Blocked by:** 01 (Walking skeleton)

**Status:** ready-for-agent

- [ ] A Go Dropbox port interface covering the operations listed in the spec; the in-memory fake implements all of it
- [ ] The fake has its own tests: the revision changes on every write, conditional uploads conflict on a revision mismatch, paths are case-insensitive but keep their display case, and create/move onto an existing path fails
- [ ] Tree API returns every entry from one recursive listing, with path (display case), kind, size and an openable flag (too-large files are marked)
- [ ] Open-file API returns LF content, revision, the detected line ending, a trailing-newline flag and BOM presence; it refuses files over 5 MB (`too-large`) and Binary Files (`binary-file`: not valid UTF-8, or containing a null byte)
- [ ] Every client-supplied path is cleaned: `..`, encoded traversal, absolute paths, empty segments and control characters are rejected with `invalid-path` (HTTP-seam tests for each)
- [ ] Errors use the single JSON error shape with a machine-readable code
- [ ] Sidebar tree with expand/collapse; Binary Files and too-large files are visibly marked and don't open; a file found to be binary on open is marked as binary for the rest of the session
- [ ] Clicking a Text File shows its content in CodeMirror (Playwright test against fixture files)
