# Use Dropbox "App Folder" access, not "Full Dropbox"

The Dropbox refresh token lives on a public VPS, so a server compromise would expose whatever the token can reach. We register the Dropbox app with App Folder access, so the token can only reach `/Apps/webedit/`, and the edited files move there. Full Dropbox access would have let the files stay where they were, but a stolen token would then expose the Owner's entire Dropbox. If the files cannot be moved, fall back to Full Dropbox with the server refusing every path outside the Root Folder (compared case-insensitively).
