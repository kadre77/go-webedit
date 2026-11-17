# webedit

A single-user, Sublime-style web editor for the text files in one Dropbox folder. See `GLOSSARY.md`, `docs/adr/` and `.scratch/webedit/spec.md`.

## Layout

- `cmd/webedit`: the server binary
- `internal/config`: environment configuration, validated at startup
- `internal/dropbox`: the Dropbox port (one interface for all Dropbox access) and the in-memory fake used by tests and test mode
- `internal/server`: the Echo server (JSON API under `/api`, the Solid app everywhere else)
- `web/`: the SolidJS frontend (Vite, TypeScript, pnpm); `web/embed.go` embeds `web/dist` into the binary

## Commands

Requires Go, Node with corepack (for pnpm), and Docker for the image.

| Command          | What it does                                                                   |
| ---------------- | ------------------------------------------------------------------------------ |
| `make test-go`   | Go HTTP-seam tests (in-process server via `httptest`)                          |
| `make test-e2e`  | Builds the frontend, then runs Playwright against the real binary in test mode |
| `make test`      | Both suites                                                                    |
| `make typecheck` | `go vet` and the TypeScript typecheck                                          |
| `make build`     | Builds the frontend and `bin/webedit`                                          |
| `make docker`    | Builds the production image                                                    |

First run of the e2e suite: `cd web && corepack pnpm install && corepack pnpm exec playwright install chromium`.

## Configuration

All configuration is environment variables. The server refuses to start, naming each problem, if any is missing or malformed.

| Variable                     | Meaning                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `WEBEDIT_DROPBOX_APP_KEY`    | Dropbox app key (not needed in test mode)                                                     |
| `WEBEDIT_DROPBOX_APP_SECRET` | Dropbox app secret (not needed in test mode)                                                  |
| `WEBEDIT_OWNER_ACCOUNT_ID`   | The Owner's Dropbox account ID, the only account allowed to sign in                           |
| `WEBEDIT_BASE_URL`           | Public base URL, scheme and host only (e.g. `https://edit.example.com`)                       |
| `WEBEDIT_SESSION_SECRET`     | Session-signing secret, at least 32 characters; rotating it signs out every device            |
| `WEBEDIT_TOKEN_KEY`          | Refresh-token encryption key: 32 random bytes, standard base64 (`openssl rand -base64 32`)    |
| `WEBEDIT_DATA_DIR`           | Absolute path of the data directory (the Dokku storage mount)                                 |
| `PORT`                       | Listen port (default `8080`; the image sets `5000`)                                           |
| `WEBEDIT_TEST_MODE`          | `1`/`true` turns on test mode (for Playwright). Refused with an `https` non-loopback base URL |
| `WEBEDIT_TEST_FIXTURES`      | Test mode only: a directory whose contents seed the fake Dropbox (Playwright uses `web/e2e/fixtures` via `web/e2e/serve.sh`) |

Health check: `GET /api/health`.
