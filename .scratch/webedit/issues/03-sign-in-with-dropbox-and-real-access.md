# 03: Sign in with Dropbox and real Dropbox access

**What to build:** The Owner signs in with Dropbox and browses their real files on the deployed app; any other Dropbox account is refused. Covers the OAuth flow, sessions, encrypted storage of the refresh token, the security envelope, and the real Dropbox adapter for listing and downloading. In test mode, sign-in is replaced by immediate sign-in as a fake account. See `../spec.md` (Sign-in and sessions, Security headers and logging, Dropbox access) and ADRs 0002 and 0003.

**Blocked by:** 02 (Browse the Root Folder read-only)

**Status:** done

- [x] Dropbox OAuth authorization-code flow with PKCE and a `state` value bound to a short-lived cookie; a mismatched or missing state is refused
- [x] After the code exchange, only the configured Owner account ID is accepted; other accounts are refused and their tokens are never stored
- [x] Refresh token stored encrypted with an authenticated cipher in the data directory; the file contains no plaintext token, and the wrong key fails clearly (tested)
- [x] Session cookie is signed, `HttpOnly`, `Secure`, `SameSite=Lax`, valid 30 days, and holds only the account ID and expiry; rotating the session secret invalidates existing sessions (tested)
- [x] Sign-out clears the session; a session-status API exists; unauthenticated `/api` calls return 401 and the frontend redirects to sign-in
- [x] A rejected refresh token returns `reauthorize`, and the frontend sends the Owner to sign in again with a clear message
- [x] State-changing requests without an `Origin` equal to the public base URL get 403 `forbidden-origin` (tested)
- [x] Every response carries the security headers from the spec (CSP `default-src 'self'` with no inline script or eval, HSTS, nosniff, `Referrer-Policy: same-origin`, `frame-ancestors 'none'`) (tested)
- [x] Request logs never contain cookies, authorization headers, OAuth codes or tokens (tested)
- [x] Real Dropbox adapter implements list (recursive), download with revision, the code exchange (which returns the approving account ID) and token refresh; it requests only the four scopes in the spec; rate limits and transient failures map to `dropbox-unavailable`
- [x] Playwright and HTTP-seam tests sign in through the test-mode fake account
