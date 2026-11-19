# 17: The indentation test is skipped on the phone layout

**What's wrong:** `web/e2e/editor.spec.ts:43` skips the auto-indent test on phone with "synthetic Enter is unreliable on the emulated phone". Ticket 05 (82d9ff4) added the skip, and the review accepted it as a judgement call. No one has checked whether the phone layout really indents correctly.

**Decide:** find out why synthetic Enter fails there (CodeMirror reads `beforeinput` on touch devices, so try `page.keyboard.insertText("\n")` or dispatching `insertNewlineAndIndent`), then remove the skip or replace it with a test that works.

**Status:** needs-triage

## Comments

- 2026-11-19: Found by the retro of the 29470b1..6cb776e sessions.
