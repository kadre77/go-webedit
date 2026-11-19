# 15: Dropbox errors that aren't outages show as "Dropbox could not be reached"

**What's wrong:**

- `dropboxError` in `internal/server/files.go` maps every unrecognised Dropbox error to `dropbox-unavailable` ("Try again"). Permanent errors (a 409 such as `path/malformed_path`) and rate limits (`too_many_write_operations` from `move_v2`/`delete_v2`) tell the Owner to retry something that won't work, or don't say to wait.
- In `internal/dropbox/client.go` (the retry loop, around line 199), any second 401 becomes `ErrReauthorize`, including `missing_scope`, where signing in again won't help.

Flagged by the spec review of ticket 03 (597d4bb) and of ticket 10 (a1f7f5a), then deferred and never tracked.

**Decide:** which Dropbox error tags get their own code (and so a new entry in the spec's closed list; `make docs-check` enforces this), and which stay `dropbox-unavailable`.

**Status:** needs-triage

## Comments

- 2026-11-19: Found by the retro of the 29470b1..6cb776e sessions.
