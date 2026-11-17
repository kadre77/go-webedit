# Spec: webedit, a Sublime-style editor for one Dropbox folder

Status: ready-for-agent

See `GLOSSARY.md` for terms (Root Folder, Text File, Binary File, Owner, Draft, Save Conflict, Tab, Preview Tab, Goto Anything, Command Palette) and `docs/adr/0001`–`0003` for the decisions on Dropbox API access, sign-in with Dropbox, and App Folder access.

## Problem Statement

The Owner keeps a folder of mostly Markdown text files in Dropbox and wants to edit them from any device, desktop or phone, through a browser. Today that means installing Dropbox and a desktop editor on every machine, or putting up with the Dropbox web UI and phone apps, which are poor editors. The Owner likes Sublime Text's interface: a sidebar file tree, tabs, fuzzy file finding, a command palette, multiple cursors, and the Mariana dark theme. They want that experience in a browser, on files that stay in Dropbox, without risking edits made on another device being silently overwritten.

## Solution

A single-user web app on a public VPS (deployed with Dokku from a Dockerfile). The Owner signs in with their Dropbox account, and every other Dropbox account is rejected. The app shows the Root Folder (the Dropbox App Folder `/Apps/webedit/`) in a Sublime-like interface built on CodeMirror 6 with a Mariana dark theme: a sidebar tree, Tabs with a Preview Tab, Goto Anything, a Command Palette, multi-cursor editing, and jump to a Markdown heading. Saving is explicit and checked against the Dropbox revision, so a file changed elsewhere causes a Save Conflict the Owner resolves instead of a silent overwrite. Drafts and open Tabs survive page reloads. On a phone the same app becomes a drawer, a tab strip and a touch toolbar.

## User Stories

### Signing in and security

1. As the Owner, I want to sign in with my Dropbox account, so that I don't have to manage a separate password.
2. As the Owner, I want my Dropbox two-factor authentication to protect the app, so that a leaked password alone can't get anyone into my files.
3. As the Owner, I want any other Dropbox account to be refused at sign-in, so that nobody else can use my deployment even if they find its URL.
4. As the Owner, I want to stay signed in on a device for about 30 days, so that I'm not logging in every time I open my phone.
5. As the Owner, I want a sign-out command, so that I can end the session on a shared or borrowed device.
6. As the Owner, I want to log out every device at once by rotating a server secret, so that I can recover from a lost or stolen device.
7. As the Owner, I want the app to be reachable only over HTTPS, so that my files and session can't be read in transit.
8. As the Owner, I want requests that change files to be rejected unless they come from the app's own origin, so that a malicious site can't make my browser edit or delete my files.
9. As the Owner, I want the stored Dropbox refresh token encrypted at rest, so that a leaked backup or disk image doesn't expose my Dropbox.
10. As the Owner, I want the app to request only the Dropbox permissions it needs, inside its App Folder only, so that a server compromise exposes as little as possible.
11. As the Owner, I want any path that tries to escape the Root Folder (`..`, encoded or absolute paths) to be rejected, so that the app can never touch anything else.
12. As the Owner, I want a strict content security policy, so that a malicious file name or file content can't run script in my session.
13. As the Owner, I want tokens and cookies never written to logs, so that reading the server logs doesn't hand out access.
14. As the Owner, when my Dropbox authorization is revoked or expires, I want to be sent back to sign-in with a clear message, so that I understand why the app stopped working.

### File tree and navigation

15. As the Owner, I want a sidebar tree of the whole Root Folder, so that I can browse my files like in Sublime.
16. As the Owner, I want folders in the tree to expand and collapse, so that I can focus on the part I'm working in.
17. As the Owner, I want Binary Files to appear in the tree but be marked as not openable, so that I know they exist but don't open them by accident.
18. As the Owner, I want files over 5 MB to be marked as too large to open, so that the editor stays responsive.
19. As the Owner, I want a Refresh command that reloads the tree from Dropbox, so that I can see files added from other devices.
20. As the Owner, I want Goto Anything (Ctrl+P) to fuzzy-find any Text File by typing part of its path, so that I can open files without clicking through folders.
21. As the Owner, I want Goto Anything results ranked so that a file-name match beats a match spread across the path, so that the file I mean comes first.
22. As the Owner, I want to open a Goto Anything result with Enter and move through results with the arrow keys, so that I never have to reach for the mouse.
23. As the Owner, I want the file I'm editing to be highlighted in the sidebar tree, so that I can see where it lives.

### Tabs

24. As the Owner, I want a single click on a file to open it in a Preview Tab, so that I can glance at files without collecting tabs.
25. As the Owner, I want a Preview Tab to become a normal Tab when I edit it or double-click it, so that files I'm working on stay open.
26. As the Owner, I want single-clicking another file to replace the Preview Tab, so that browsing stays tidy.
27. As the Owner, I want a Tab with a Draft to show a modified dot, so that I can see what isn't saved.
28. As the Owner, I want closing a Tab with a Draft to ask before discarding it, so that I don't lose work by accident.
29. As the Owner, I want Sublime-style shortcuts to switch and close Tabs (Ctrl+W, Ctrl+Tab, Ctrl+PageUp/PageDown, Alt+number), so that my muscle memory works.
30. As the Owner, I want my open Tabs restored when I come back to the app in the same browser, so that I can pick up where I left off.

### Editing

31. As the Owner, I want the Mariana dark theme, so that the app looks and feels like my Sublime setup.
32. As the Owner, I want syntax highlighting chosen from the file extension, so that code and Markdown are readable.
33. As the Owner, I want Markdown highlighting to be first-class, so that my notes read well while I edit them.
34. As the Owner, I want highlighting for JS/TS, JSON, HTML/CSS, Go, Python, YAML, Shell and SQL, loaded only when needed, so that the app stays fast to load.
35. As the Owner, I want unknown file types to open as plain text, so that I can still edit them.
36. As the Owner, I want multiple cursors with Ctrl+click and Ctrl+D (select next occurrence) on desktop, so that I can make repeated edits quickly.
37. As the Owner, I want Sublime's core editing shortcuts (duplicate line, move line up/down, toggle comment, select line, split selection into lines, join lines), so that the editor behaves like Sublime.
38. As the Owner, I want find and replace inside the current file (Ctrl+F, Ctrl+H), so that I can make targeted changes.
39. As the Owner, I want Go to Line (Ctrl+G), so that I can jump to a line number.
40. As the Owner, I want Ctrl+R to list a Markdown file's headings and jump to the one I pick, so that I can move around long notes.
41. As the Owner, I want indentation (spaces or tabs, and width) detected from each file, so that my edits match the file's existing style.

### Saving and conflicts

42. As the Owner, I want to save with Ctrl+S, so that I decide when changes go to Dropbox.
43. As the Owner, I want saving to keep the file's original line endings (LF or CRLF) and trailing newline, so that saves don't create noisy whole-file diffs.
44. As the Owner, I want a save to be refused if the file changed in Dropbox since I opened it, so that I never silently overwrite edits from another device.
45. As the Owner, when a Save Conflict happens, I want to choose between overwriting with mine, reloading theirs, or saving mine as a copy next to the original, so that I can resolve it without losing either version.
46. As the Owner, I want my Draft kept in browser storage as I type, so that a crash, reload or closed tab doesn't lose unsaved work.
47. As the Owner, when I reopen a file that has a stored Draft, I want the Draft restored and marked modified, so that I can still save or discard it.
48. As the Owner, when a Tab regains focus, I want the app to check whether the file changed in Dropbox, so that I learn about outside edits early.
49. As the Owner, when a file with no Draft changed in Dropbox, I want the Tab to reload the new content quietly, so that I'm always looking at the current version.
50. As the Owner, when a file with a Draft changed in Dropbox, I want to be told (and not have my Draft replaced), so that I can decide what to do before saving.
51. As the Owner, I want a clear error when a save fails for network or Dropbox reasons, with my Draft kept, so that I can retry.
52. As the Owner, I want a warning before leaving the page with unsaved Drafts, so that I don't close the browser tab by mistake.

### File management

53. As the Owner, I want to create a new file from the sidebar or the Command Palette, so that I can start notes without leaving the app.
54. As the Owner, I want to create a new folder, so that I can organise my files.
55. As the Owner, I want to rename or move a file or folder, so that I can reorganise, with any open Tabs following the new path.
56. As the Owner, I want delete to ask for confirmation and rely on Dropbox's trash, so that a mistaken delete is recoverable.
57. As the Owner, I want these actions in a right-click menu on desktop and a long-press menu on the phone, so that they're where I expect them.
58. As the Owner, I want creating or renaming to something that already exists to fail with a clear message, so that nothing is overwritten.

### Command Palette and settings

59. As the Owner, I want a Command Palette (Ctrl+Shift+P) that fuzzy-searches the app's commands, so that every action can be reached from the keyboard.
60. As the Owner, I want the Command Palette to show each command's shortcut, so that I learn the shortcuts over time.
61. As the Owner, I want to change the font size, so that text is comfortable on each device.
62. As the Owner, I want to toggle word wrap, on by default on phones and off on desktop, so that long lines are readable on a small screen.
63. As the Owner, I want to set a default tab width and spaces-or-tabs for files where it can't be detected, so that new files use my style.
64. As the Owner, I want settings remembered per browser, so that my phone and desktop can differ.

### Phone

65. As the Owner, I want the sidebar to become a slide-out drawer on a phone, so that the editor gets the full width.
66. As the Owner, I want Tabs shown as a compact strip or dropdown on a phone, so that I can switch files on a narrow screen.
67. As the Owner, I want a toolbar with Save, Goto Anything and Command Palette buttons on a phone, so that I can reach them without a keyboard.
68. As the Owner, I want editing on a phone to work with the on-screen keyboard, including selection and copy/paste, so that quick fixes on the go are practical.
69. As the Owner, I want long-press menus in the drawer for file management, so that I can manage files on a phone.

### Operating the deployment

70. As the Owner, I want to deploy with `git push` to Dokku using the Dockerfile, so that releasing is one command.
71. As the Owner, I want all configuration supplied as environment variables, so that I can change it with `dokku config:set`.
72. As the Owner, I want the encrypted token stored on a Dokku persistent storage mount, so that redeploys don't log the app out of Dropbox.
73. As the Owner, I want the server to refuse to start with missing or invalid configuration, naming what's wrong, so that mistakes surface at deploy time.
74. As the Owner, I want a health-check endpoint, so that Dokku can tell whether the app is up before switching traffic.

## Implementation Decisions

### Architecture and deployment

- Monorepo with a Go backend (Echo framework) and a SolidJS frontend (Vite, TypeScript, pnpm). The built frontend is embedded in the Go binary, which serves it alongside a JSON API under `/api`. One process, one image.
- Multi-stage Dockerfile: a Node stage builds the frontend, a Go stage builds a static binary with the frontend embedded, and the runtime stage is a distroless non-root image.
- Deployed to a public VPS with Dokku. HTTPS through the Dokku Let's Encrypt plugin. The app sets HSTS.
- Configuration through environment variables: Dropbox app key and secret, the Owner's Dropbox account ID, the public base URL (for the OAuth redirect and Origin checks), the session-signing secret, the token-encryption key, and the data directory on the storage mount. Missing or malformed values stop startup with a message naming the variable.
- A health-check endpoint that does not require a session.

### Dropbox access (ADR 0001, ADR 0003)

- The server uses the Dropbox HTTP API, never a locally synced folder.
- The Dropbox app is registered with App Folder access, so the Root Folder is the App Folder. Scopes are limited to `account_info.read`, `files.metadata.read`, `files.content.read` and `files.content.write`.
- All Dropbox access sits behind one Go interface, the Dropbox port. It covers: the authorization URL and OAuth code exchange (with PKCE; the exchange returns the refresh token and the approving account ID), token refresh, recursive folder listing, downloading a file with its revision, uploading with an "update only if revision matches" mode, uploading a new file that must not exist, creating a folder, moving/renaming, and deleting. A real adapter calls Dropbox. An in-memory fake implements the same interface for tests and for the test mode (see Testing Decisions).
- The fake must behave like Dropbox where it matters: revisions change on every write, conditional uploads fail with a conflict when the revision doesn't match, paths are case-insensitive but keep their display case, and moves into an existing path fail.
- Dropbox paths are case-insensitive. The server cleans every client-supplied path (rejecting `..` segments, empty segments, control characters, and anything that resolves outside the Root Folder) before it reaches the Dropbox port. Segments that would still become `.`, `..` or contain a separator after further percent-decoding are rejected too, so a file literally named like `%2e%2e` or `a%2fb` can't be opened: a deliberate trade for defence against a layer that decodes again. If ADR 0003's fallback to Full Dropbox is ever used, the Root Folder prefix check must compare case-insensitively.
- The refresh token is encrypted with an authenticated cipher keyed by the token-encryption key and stored as a file in the data directory. Access tokens live only in memory and are refreshed when they expire.
- Requests to Dropbox that are rate-limited or fail transiently surface to the client as a retryable error. The client keeps the Draft.

### Sign-in and sessions (ADR 0002)

- Sign-in is the Dropbox OAuth authorization-code flow with PKCE and a `state` value bound to the browser in a short-lived cookie.
- The code exchange returns the approving account ID from Dropbox, and the server compares it with the configured Owner account ID. Any other account is refused, and its token is not stored.
- On success the server stores the refresh token (replacing any earlier one) and issues a session cookie: signed, `HttpOnly`, `Secure`, `SameSite=Lax`, valid for 30 days. The session holds only the account ID and an expiry. Rotating the session secret invalidates every session.
- Sign-out clears the cookie.
- Every `/api` route except the health check and the OAuth start/callback requires a valid session. Unauthenticated API calls return 401, and the frontend redirects to sign-in.
- Every state-changing request must carry an `Origin` header equal to the configured public base URL, or it is rejected with 403.
- If Dropbox rejects the stored refresh token (revoked or expired), the API returns a distinct "reauthorize" error and the frontend sends the Owner to sign in again.

### Security headers and logging

- Responses set a strict Content-Security-Policy (`default-src 'self'`, no inline script, no `eval`; the app page carries a fresh nonce that allows CodeMirror's injected `<style>` element and nothing else, and is never cached), HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` and `frame-ancestors 'none'`.
- Request logging never records cookies, authorization headers, OAuth codes or tokens.

### API contract (JSON under `/api`)

Shapes, not exact names:

- **Tree:** returns every entry in the Root Folder from one recursive listing: path (display case), kind (file or folder), size, and for files whether they are openable (a Text File) or not (and why: binary or too large). Whether a file is binary can't be known from metadata alone, so the tree reports size and leaves text-vs-binary to opening (see Open file).
- **Open file:** takes a path, returns content, revision, and the detected line ending and trailing-newline flag. Refuses files over 5 MB. Refuses Binary Files (not valid UTF-8, or containing a null byte) with a distinct error, and the frontend then marks that file as binary in the tree for the rest of the session.
- **Check file:** takes a path, returns its current revision, so a Tab can tell whether the file changed in Dropbox when it regains focus.
- **Save file:** takes a path, content and the revision it was opened at. The server applies the file's original line endings and trailing newline before uploading with a revision-match condition. On success returns the new revision. On mismatch returns a Save Conflict error with the current revision.
- **Save as copy:** takes a path and content, writes it to a new sibling path (the original name with a "conflicted copy" suffix and a timestamp, made unique if needed), and returns the new path and revision.
- **Create file / create folder:** fail if something already exists at the path.
- **Move:** renames or moves a file or folder, and fails if the destination exists.
- **Delete:** deletes a file or folder. Dropbox keeps deleted items in its trash.
- **Session:** returns whether the caller is signed in. Sign-in start (`GET /auth/signin`), OAuth callback (`GET /auth/callback`, the redirect URI registered with Dropbox) and sign-out (`POST /auth/signout`) are plain browser routes, not JSON. They end on the app's `/signin?reason=...` page when sign-in fails or after sign-out.
- Errors use one JSON shape with a machine-readable code and a human message. The codes are: bad-request, unauthorized, reauthorize, forbidden-origin, invalid-path, not-found, not-a-file (a folder where a file was expected), already-exists, conflict, binary-file, too-large, dropbox-unavailable. A new code is added to this list when it is introduced.

### Line endings and encoding

- A Text File is valid UTF-8 with no null byte, at most 5 MB. Anything else that is openable by size is a Binary File.
- On open the server detects the dominant line ending (CRLF if any line uses CRLF and most do, otherwise LF) and whether the file ends with a newline, and sends the content with LF line endings plus those two facts. The editor always works in LF.
- On save the client sends LF content and the revision it opened. The server downloads the file at that revision and restores its BOM, trailing-newline state and line endings: lines in the unchanged runs at the start and end of the file keep their own endings (so mixed endings survive), and the lines between get the dominant one. Deriving the facts on the server, instead of having the client send them back, keeps them correct without trusting the client, at the cost of one download per save.

### Frontend

- SolidJS application with these modules:
  - **API client:** typed wrapper over the JSON API that turns error codes into typed failures and handles 401/reauthorize redirects.
  - **App state:** the tree, open Tabs (including which one is the Preview Tab), the active Tab, Drafts, and each Tab's revision. It also owns the conflict and outside-change rules.
  - **Draft store:** persists Drafts, the list of open Tabs and the active Tab in browser storage (IndexedDB), keyed by path, and restores them on load. It wraps every storage call so the app still works when storage is unavailable.
  - **Editor view:** CodeMirror 6 with the Mariana dark theme, language detection by file extension with languages loaded lazily, indentation detection, the Sublime-style keymap, multi-cursor (desktop), search and replace, and go-to-line.
  - **Goto Anything** and **Command Palette:** one shared fuzzy-finder overlay used by both, ranking file-name matches above matches spread across the path.
  - **Goto heading (Ctrl+R):** lists Markdown headings from CodeMirror's Markdown syntax tree. For other languages it shows "no symbols".
  - **Sidebar:** the file tree with right-click/long-press context menus for new file, new folder, rename/move and delete.
  - **Conflict dialog:** shows the three Save Conflict choices.
  - **Settings:** font size, word wrap (default on for phones, off for desktop), default tab width, default spaces-or-tabs. Stored in browser storage.
  - **Layout:** a desktop layout (sidebar, tab bar, editor) and a phone layout (drawer, compact tabs, touch toolbar), switched by viewport width.
- The Sublime keymap is written for this app. CodeMirror 6 has no official Sublime keymap, but its built-in commands cover multi-cursor and select-next-occurrence (Ctrl+D). Shortcuts use Cmd instead of Ctrl on macOS.
- Outside-change rules when a Tab regains focus: if the Dropbox revision is unchanged, do nothing. If it changed and the Tab has no Draft, reload the content. If it changed and the Tab has a Draft, show a notice and keep the Draft. The next save will raise a Save Conflict.
- Rename/move updates every open Tab and stored Draft under the old path. Delete closes the affected Tabs after confirmation and drops their Drafts.

### Test mode

- The binary has a test mode, enabled only by an explicit environment variable, that swaps the real Dropbox adapter for the in-memory fake, seeded from a fixture directory, and replaces the Dropbox OAuth redirect with an immediate sign-in as a configured fake account. The server refuses to start in test mode when the configured public base URL uses `https` and is not a loopback host, so test mode can't be switched on by accident in production.

## Testing Decisions

- **What a good test is:** it exercises external behaviour through one of the two agreed seams and asserts on what the Owner or an API client can observe (HTTP status and body, files in the fake Dropbox, what's on screen). It never asserts on internal structure, private functions, or the order of internal calls. Tests should survive a refactor that keeps behaviour the same.
- **Seam 1: HTTP API (Go tests).** The real Echo server runs in-process through `httptest`, wired to the in-memory fake Dropbox. This is where most behaviour is tested:
  - sign-in: PKCE/state handling, accepting the Owner, refusing other accounts, session cookie flags and expiry, sign-out, and reauthorization when the refresh token is rejected
  - Origin enforcement on state-changing requests
  - security headers on every response type
  - path cleaning and Root Folder confinement, including `..`, encoded traversal, absolute paths and case variants
  - tree listing
  - Text File vs Binary File detection, and the 5 MB limit
  - line-ending and trailing-newline round-trips (LF, CRLF, mixed, no final newline, BOM)
  - revision-checked saves and Save Conflicts, and save as copy (including name collisions)
  - create, move and delete, including "already exists"
  - the refresh token encrypted on disk (the stored file contains no plaintext token, and a wrong key fails to start the app or to read the token)
  - no tokens or cookies in logs
  - configuration validation at startup
  - test mode refusing to start under a production-looking base URL
- **Seam 2: browser (Playwright).** The tests drive the real binary in test mode, at a desktop and a phone viewport. This covers:
  - opening files from the tree and from Goto Anything, Preview Tab behaviour, and the modified dot
  - Ctrl+S saving (checked in the fake Dropbox)
  - the Save Conflict dialog's three choices (provoked by changing the file in the fake between open and save, through a test-only hook)
  - Drafts and open Tabs surviving a page reload
  - outside-change handling on focus
  - the Command Palette, Ctrl+R headings and go to line
  - multi-cursor/Ctrl+D on desktop
  - file management from context menus
  - settings persisting
  - the phone drawer, toolbar and long-press menu
- **Deliberately not tested:** individual Solid components in isolation, internal Go functions, and CodeMirror in jsdom. The two seams already cover their behaviour, and CodeMirror needs a real browser.
- **The fake is load-bearing.** It gets its own tests asserting the Dropbox behaviours the app relies on (revision changes, conditional upload conflicts, case-insensitive paths with display case kept, move/create collisions), so the fake can't drift into being more forgiving than Dropbox.
- **Prior art:** none yet. This is a greenfield repo, so these tests set the pattern.

## Out of Scope

- Markdown preview (planned for version 2: side-by-side on desktop, a toggle on the phone, sanitised, with relative images loaded through the server).
- Minimap, split panes, and find in files across the Root Folder.
- Live change detection (Dropbox long-polling pushed to the browser). Version 1 relies on Refresh, focus checks and revision-checked saves.
- Uploading files from the device, and downloading or viewing Binary Files.
- Cloudflare Access, Tailscale or any second gate in front of the app.
- More than one user or more than one Root Folder. Full Dropbox access, except as ADR 0003's fallback.
- Plugins, user-defined commands, per-folder or per-project settings files, and Sublime settings-file compatibility.
- Light themes, and themes other than Mariana dark.
- Editing files that aren't UTF-8, or files over 5 MB.
- Offline editing beyond keeping Drafts in browser storage. There is no offline save queue.
- Multi-cursor on phones.

## Further Notes

- The Owner will move the files they want to edit into `/Apps/webedit/` after the Dropbox app is registered. If that turns out to be impossible, switch to ADR 0003's Full Dropbox fallback, which makes the case-insensitive Root Folder prefix check a security requirement.
- Registering the Dropbox app, setting the OAuth redirect URL, setting Dokku config and creating the storage mount are steps only the Owner can do. The `/wizard` skill is a good fit for scripting them.
- The folder is mostly Markdown, so when trade-offs come up, Markdown editing quality comes before the other languages.
