# 18: API responses don't say "no-store"

**What's wrong:** only `serveIndex` in `internal/server/server.go` sets `Cache-Control: no-store`. `/api/*` responses, including `GET /api/file` with a file's contents, send no caching header at all, so a browser or proxy may cache them heuristically. A cached response would hide a change made elsewhere, the symptom ticket 07 exists to prevent. The Owner's report on 2026-11-19 turned out to have another cause, but the gap is real.

**Fix:** middleware on the `/api` group sets `Cache-Control: no-store`, with a Go test over the API routes like the existing one in `security_test.go`. It also keeps the file contents out of any shared cache.

**Status:** done

## Comments

- 2026-11-19: Found by the retro of the 29470b1..6cb776e sessions.
- 2026-11-19: Fixed. `noStoreAPI` in `security.go` sets `Cache-Control: no-store` on every `/api` response. It is server-wide middleware, not middleware on the `/api` group, so that the bare `/api` 404 and the Origin check's 403 carry it too. `TestNoAPIResponseMayBeStored` covers successes, errors, unknown routes, signed-out and forbidden-origin responses. Ticket 20 had suspected this, but it was not the cause there.
