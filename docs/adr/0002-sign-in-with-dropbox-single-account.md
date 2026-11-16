# Sign in with Dropbox, restricted to one account

The app is public on the internet, so it needs authentication, but it already needs a Dropbox OAuth token. We use one Dropbox OAuth flow for both jobs: it logs the Owner in and gives the server its API token, and any Dropbox account other than the configured account ID is rejected. This gets Dropbox's 2FA for free with no password of our own to store. A self-managed password or passkeys were the alternatives.
