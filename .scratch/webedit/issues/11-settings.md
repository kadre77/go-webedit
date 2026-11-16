# 11: Settings

**What to build:** The Owner can adjust font size, word wrap, default tab width and default spaces-or-tabs. Settings are remembered per browser, so phone and desktop differ, and word wrap defaults to on for phones and off for desktop. See `../spec.md` (Frontend: settings) and user stories 61–64.

**Blocked by:** 05 (Editor feel)

**Status:** ready-for-agent

- [ ] Font size (increase, decrease, reset), word-wrap toggle, default tab width and default spaces-or-tabs
- [ ] Defaults: word wrap on for phone viewports and off for desktop until the Owner changes it
- [ ] Defaults for tab width and spaces-or-tabs apply only where indentation can't be detected (for example a new or empty file)
- [ ] Settings persist in browser storage and survive a reload; unavailable storage falls back to defaults without errors
- [ ] Each setting is reachable from the Command Palette (once ticket 09's registry exists; otherwise from a settings menu)
- [ ] Changes apply immediately to all open Tabs
- [ ] Playwright test: change font size and word wrap, reload, settings kept
