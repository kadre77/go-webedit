#!/bin/sh
# Starts the real binary in test mode for Playwright, with the fake Dropbox
# seeded from e2e/fixtures plus generated files that shouldn't live in git:
# one over 5 MB and one that isn't valid UTF-8. Run from the repo root.
#
# The binary embeds web/dist, so the frontend is rebuilt first whenever its
# sources are newer than the last build (a bare `playwright test` would
# otherwise serve stale code). The server's log goes to
# $WEBEDIT_DATA_DIR/server.log, not into the test output.
set -eu
data="$WEBEDIT_DATA_DIR"
fixtures="$data/fixtures"
rm -rf "$fixtures"
mkdir -p "$data"
cp -R web/e2e/fixtures "$fixtures"
head -c 5300000 /dev/zero | tr '\0' 'a' > "$fixtures/big.log"
printf 'caf\351 au lait\n' > "$fixtures/Notes/latin1.txt"
if [ ! -f web/dist/index.html ] ||
  [ -n "$(find web/src web/index.html web/vite.config.ts -newer web/dist/index.html -print -quit)" ]; then
  echo "web/dist is older than web/src: rebuilding the frontend" >&2
  # dist/.gitkeep is tracked so go:embed finds dist in a fresh clone.
  (cd web && corepack pnpm exec vite build --logLevel warn >&2 && touch dist/.gitkeep)
fi
go build -o bin/webedit ./cmd/webedit
echo "webedit e2e server log: $data/server.log" >&2
WEBEDIT_TEST_FIXTURES="$fixtures" exec ./bin/webedit > "$data/server.log" 2>&1
