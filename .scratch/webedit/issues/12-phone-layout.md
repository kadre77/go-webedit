# 12: Phone layout

**What to build:** On a phone the same app becomes a touch layout: the sidebar is a slide-out drawer, Tabs are a compact strip or dropdown, a toolbar gives Save, Goto Anything and Command Palette buttons, file management is a long-press menu in the drawer, and editing works with the on-screen keyboard. Multi-cursor stays desktop-only. See `../spec.md` (Frontend: layout) and user stories 65–69.

**Blocked by:** 06 (Save), 09 (Goto Anything, Command Palette and Ctrl+R), 10 (File management)

**Status:** done

- [x] Layout switches by viewport width between desktop and phone
- [x] The sidebar becomes a drawer opened by a button or swipe, closing after a file is opened
- [x] Tabs shown as a compact horizontal strip or dropdown, with the modified dot visible
- [x] Toolbar with Save, Goto Anything and Command Palette buttons
- [x] Long-press on a drawer entry opens the file-management menu
- [x] Editing works with the on-screen keyboard, including touch selection and copy/paste; the toolbar stays reachable while the keyboard is open
- [x] Playwright tests at a phone viewport cover the drawer, opening a file, editing and saving with the toolbar, and the long-press menu

## Comments

- Implemented with the drawer, scrim, edge swipe, bottom toolbar (Files, Goto Anything, Command Palette, Save) and a timed long-press on tree rows (Android Chrome also fires its own contextmenu; iOS Safari doesn't). The toolbar buttons don't take focus, so the on-screen keyboard stays up.
- Keyboard: `interactive-widget=resizes-content` for Chrome on Android, and the app sized to `visualViewport` for iOS Safari. Touch selection and copy/paste are CodeMirror's own; neither these nor the iOS paths can be exercised in emulated Chromium, so they want a check on a real phone.
- Existing specs now open the drawer before using the tree on a phone, through `web/e2e/ui.ts` (`showTree`, `clickItem`).
- Not done: long-press on the tree's empty space (the root-level New File/Folder the desktop right-click gives); the Command Palette covers it. Multi-cursor isn't disabled on phones, just not offered.
