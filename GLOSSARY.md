# webedit

A single-user web editor for the text files in one Dropbox folder, usable from desktop and phone.

## Language

**Root Folder**:
The one Dropbox folder the app edits (the app's Dropbox App Folder); every path the app shows is relative to it.
_Avoid_: Workspace, project, Dropbox (when you mean only this folder)

**Text File**:
A file inside the Root Folder that the app will open in the editor: not binary and at most 5 MB.
_Avoid_: Document

**Binary File**:
A file inside the Root Folder that is listed in the file tree but never opened in the editor.

**Owner**:
The single Dropbox account allowed to sign in to the app.
_Avoid_: User, admin

**Draft**:
Edits to an open Text File that have not been saved to Dropbox yet.
_Avoid_: Unsaved changes, buffer

**Save Conflict**:
A save that Dropbox refuses because the file changed there after the app opened it.
_Avoid_: Merge conflict

## Editor

**Tab**:
An open Text File in the editor, holding its Draft if it has one.

**Preview Tab**:
A temporary Tab opened by a single click, replaced by the next single-clicked file unless it is edited or double-clicked.

**Goto Anything**:
The fuzzy finder that opens any Text File in the Root Folder by typing part of its path.
_Avoid_: Quick open, file search

**Command Palette**:
The fuzzy-searchable list of the app's own commands.

**Goto Heading**:
The finder (Ctrl+R) that lists the active Markdown file's headings and jumps to the one picked.
_Avoid_: Goto symbol, outline
