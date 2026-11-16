# Access Dropbox through the HTTP API from a public VPS

The server talks to Dropbox over its HTTP API (OAuth, files/download, files/upload) instead of editing a local folder kept in sync by the Dropbox desktop client. That lets the app run on a small public VPS deployed with Dokku, with no Dropbox client next to it. In exchange, every open and save is a network call, the app has to manage OAuth token refresh, and conflicts are handled by checking Dropbox file revisions instead of local file timestamps.
