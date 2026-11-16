# 12: Phone layout

**What to build:** On a phone the same app becomes a touch layout: the sidebar is a slide-out drawer, Tabs are a compact strip or dropdown, a toolbar gives Save, Goto Anything and Command Palette buttons, file management is a long-press menu in the drawer, and editing works with the on-screen keyboard. Multi-cursor stays desktop-only. See `../spec.md` (Frontend: layout) and user stories 65–69.

**Blocked by:** 06 (Save), 09 (Goto Anything, Command Palette and Ctrl+R), 10 (File management)

**Status:** ready-for-agent

- [ ] Layout switches by viewport width between desktop and phone
- [ ] The sidebar becomes a drawer opened by a button or swipe, closing after a file is opened
- [ ] Tabs shown as a compact horizontal strip or dropdown, with the modified dot visible
- [ ] Toolbar with Save, Goto Anything and Command Palette buttons
- [ ] Long-press on a drawer entry opens the file-management menu
- [ ] Editing works with the on-screen keyboard, including touch selection and copy/paste; the toolbar stays reachable while the keyboard is open
- [ ] Playwright tests at a phone viewport cover the drawer, opening a file, editing and saving with the toolbar, and the long-press menu
