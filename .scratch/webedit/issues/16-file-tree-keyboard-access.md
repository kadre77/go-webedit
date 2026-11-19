# 16: The file tree can't be used from the keyboard

**What's wrong:** tree rows in `web/src/Sidebar.tsx` (lines 68 and 224) have `tabIndex={-1}` and no roving focus, so there's no way to Tab into the tree, or to move through it and open files with the arrow keys and Enter.

Flagged by the spec review of ticket 02 (cd91f26) as "a later ticket would need to", but no ticket was filed.

**Decide:** whether this is wanted (Goto Anything already covers opening files from the keyboard), and if so, the key bindings. They must avoid the keys the browser reserves.

**Status:** needs-triage

## Comments

- 2026-11-19: Found by the retro of the 29470b1..6cb776e sessions.
