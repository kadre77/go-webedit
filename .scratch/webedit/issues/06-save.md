# 06: Save

**What to build:** The Owner edits a Text File and saves it to Dropbox with Ctrl+S. Saves are checked against the revision the file was opened at, and the file's original line endings, trailing newline and BOM are restored exactly. Tabs with a Draft show a modified dot, closing one asks first, and failed saves keep the Draft with a retryable error. See `../spec.md` (API contract: save; Line endings and encoding) and user stories 27–28, 42–43, 51.

**Blocked by:** 04 (Tabs and Preview Tab)

**Status:** ready-for-agent

- [ ] Save API takes path, LF content and the opened revision; restores the original line ending, trailing-newline state and BOM; uploads with a revision-match condition; returns the new revision
- [ ] A revision mismatch returns `conflict` with the current revision (the conflict UI is ticket 07; here the client just shows an error and keeps the Draft)
- [ ] HTTP-seam round-trip tests: LF, CRLF, mixed endings, no final newline and a BOM file come back byte-identical when saved unchanged, and with only the intended changes otherwise
- [ ] Real Dropbox adapter implements upload with a revision condition
- [ ] Ctrl+S (Cmd+S on macOS) saves the active Tab; the Tab's revision updates on success
- [ ] Tabs with a Draft show a modified dot that clears on save
- [ ] Closing a Tab with a Draft asks for confirmation before discarding it
- [ ] Network or `dropbox-unavailable` errors show a clear message and keep the Draft so the Owner can retry
- [ ] Playwright test: edit, see the dot, Ctrl+S, and the fake Dropbox holds the new content
