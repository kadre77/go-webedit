# 13: Production setup wizard

**What to build:** A `/wizard` script that walks the Owner through the setup steps only they can do, so the first production deploy works: registering the Dropbox app (App Folder access, the four scopes, the redirect URL), finding their Dropbox account ID, generating the session and token-encryption secrets, the Dokku app and `config:set`, the persistent storage mount for the data directory, the Let's Encrypt certificate, and the first `git push`. Also reminds the Owner to move the files into `/Apps/webedit/`. See `../spec.md` (Further Notes) and ADR 0003.

**Blocked by:** 03 (Sign in with Dropbox and real Dropbox access)

**Status:** ready-for-human

- [ ] The wizard opens each dashboard URL and captures each value, never echoing secrets to the terminal or committing them
- [ ] Generates strong random session and token-encryption secrets
- [ ] Sets every environment variable the app validates at startup through `dokku config:set`
- [ ] Creates and mounts the Dokku storage directory used for the encrypted token
- [ ] Enables Let's Encrypt for the app's domain
- [ ] Ends by checking the health endpoint over HTTPS and prompting the Owner to sign in
- [ ] A short runbook in the repo explains rerunning the wizard, rotating the session secret (logs out everywhere) and rotating the encryption key (requires signing in again)
