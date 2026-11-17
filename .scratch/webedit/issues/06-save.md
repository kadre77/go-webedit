# 06: Save

**What to build:** The Owner edits a Text File and saves it to Dropbox with Ctrl+S. Saves are checked against the revision the file was opened at, and the file's original line endings, trailing newline and BOM are restored exactly. Tabs with a Draft show a modified dot, closing one asks first, and failed saves keep the Draft with a retryable error. See `../spec.md` (API contract: save; Line endings and encoding) and user stories 27–28, 42–43, 51.

**Blocked by:** 04 (Tabs and Preview Tab)

**Status:** done

- [x] Save API takes path, LF content and the opened revision; restores the original line ending, trailing-newline state and BOM; uploads with a revision-match condition; returns the new revision
- [x] A revision mismatch returns `conflict` with the current revision (the conflict UI is ticket 07; here the client just shows an error and keeps the Draft)
- [x] HTTP-seam round-trip tests: LF, CRLF, mixed endings, no final newline and a BOM file come back byte-identical when saved unchanged, and with only the intended changes otherwise
- [x] Real Dropbox adapter implements upload with a revision condition
- [x] Ctrl+S (Cmd+S on macOS) saves the active Tab; the Tab's revision updates on success
- [x] Tabs with a Draft show a modified dot that clears on save
- [x] Closing a Tab with a Draft asks for confirmation before discarding it
- [x] Network or `dropbox-unavailable` errors show a clear message and keep the Draft so the Owner can retry
- [x] Playwright test: edit, see the dot, Ctrl+S, and the fake Dropbox holds the new content

## Comments

**2026-11-17 (implementation):** The save API takes path, LF content and the opened revision, as this ticket says. The server derives the BOM, trailing newline and line endings by downloading the file at save time, not from facts the client sends back. A changed revision is a Save Conflict straight away, with the current revision. Lines in the unchanged runs at the start and end of the file keep their own endings, so mixed-ending files round-trip byte-identically. The spec's "Line endings and encoding" section is updated to match, and `bad-request` is added to its error codes. Saving a file deleted in Dropbox returns `not-found` for now; ticket 07 decides how the conflict dialog treats that.
