# 14: Save drops blank lines typed at the end of a file without a final newline

**What's wrong:** `encodeText` in `internal/server/textfile.go` keeps the file's trailing-newline state with `strings.TrimRight(content, "\n")` when the original file has no final newline. Blank lines the Owner types at the end are dropped on save without a word, while the Tab still shows them with no modified dot. The test case `"a\nb"` + `"a\nb\n\n"` → `"a\nb"` locks this in.

Introduced by a review fix in ticket 06 (84e96e7), which went to commit without its own review.

**Decide:** does the original file's trailing-newline state beat the Owner's edits? A likely answer is to strip at most one `\n`, so `"a\nb\n\n"` saves as `"a\nb\n"`. Record the answer in the spec's Save section.

**Status:** needs-triage

## Comments

- 2026-11-19: Found by the retro of the 29470b1..6cb776e sessions.
