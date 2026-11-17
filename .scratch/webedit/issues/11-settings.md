# 11: Settings

**What to build:** The Owner can adjust font size, word wrap, default tab width and default spaces-or-tabs. Settings are remembered per browser, so phone and desktop differ, and word wrap defaults to on for phones and off for desktop. See `../spec.md` (Frontend: settings) and user stories 61–64.

**Blocked by:** 05 (Editor feel)

**Status:** done

- [x] Font size (increase, decrease, reset), word-wrap toggle, default tab width and default spaces-or-tabs
- [x] Defaults: word wrap on for phone viewports and off for desktop until the Owner changes it
- [x] Defaults for tab width and spaces-or-tabs apply only where indentation can't be detected (for example a new or empty file)
- [x] Settings persist in browser storage and survive a reload; unavailable storage falls back to defaults without errors
- [x] Each setting is reachable from the Command Palette (once ticket 09's registry exists; otherwise from a settings menu)
- [x] Changes apply immediately to all open Tabs
- [x] Playwright test: change font size and word wrap, reload, settings kept
