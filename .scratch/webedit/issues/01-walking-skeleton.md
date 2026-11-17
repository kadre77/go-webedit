# 01: Walking skeleton

**What to build:** A minimal, deployable end-to-end app. A Go/Echo server serves the built Solid app (embedded in the binary) and a health check, validates its configuration at startup, and has a test mode guarded against production use. It ships as one image from a multi-stage Dockerfile. Both test seams from the spec exist and run: Go `httptest` tests against the in-process server, and Playwright tests against the real binary in test mode. Demo: the image builds and runs, and a placeholder page loads in the browser. See `../spec.md` (Architecture and deployment, Test mode, Testing Decisions).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Monorepo with a Go backend (Echo) and a SolidJS frontend (Vite, TypeScript, pnpm); the built frontend is embedded in the Go binary and served at `/`
- [x] Health-check endpoint responds without a session
- [x] Startup validates every required environment variable and exits with a message naming any missing or malformed one (tested)
- [x] Test mode turns on only through an explicit environment variable, and the server refuses to start in test mode when the public base URL is `https` and not a loopback host (tested)
- [x] Multi-stage Dockerfile (Node build, Go build, distroless non-root runtime) builds an image that serves the app and the health check
- [x] A Go HTTP-seam test and a Playwright test (desktop viewport) both pass, and one documented command runs each suite
- [x] Unknown non-`/api` routes serve the Solid app (client-side routing), and unknown `/api` routes return a JSON 404

## Comments

**2026-11-16 (agent):** Implemented. `make test-go` (Go HTTP seam plus startup tests that run the real binary) and `make test-e2e` (Playwright, desktop and phone projects) both pass, and `docker build` produces an image that serves the app and the health check as `nonroot`. Configuration variables are documented in `README.md`. In test mode, the server only refuses a production base URL and drops the Dropbox credential requirement for now. The fake Dropbox and the fake sign-in arrive in tickets 02 and 03.
