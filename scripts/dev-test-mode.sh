#!/bin/sh
# Builds webedit and runs it locally in test mode: a fake, in-memory Dropbox
# seeded from a folder, and sign-in that approves at once. Nothing is written
# back to the folder.
#
# Usage: scripts/dev-test-mode.sh [folder]   (default: web/e2e/fixtures)
# Then open http://localhost:$PORT/auth/signin (PORT defaults to 8080).
set -eu

cd "$(dirname "$0")/.."

fixtures="${1:-web/e2e/fixtures}"
if [ ! -d "$fixtures" ]; then
  echo "No such folder: $fixtures" >&2
  exit 1
fi
fixtures="$(cd "$fixtures" && pwd)"
port="${PORT:-8080}"

make build

echo
echo "Serving $fixtures"
echo "Open http://localhost:$port/auth/signin"
echo

PORT="$port" \
WEBEDIT_TEST_MODE=1 \
WEBEDIT_BASE_URL="http://localhost:$port" \
WEBEDIT_OWNER_ACCOUNT_ID=dbid:test-owner \
WEBEDIT_SESSION_SECRET=test-session-secret-0123456789abcdef \
WEBEDIT_TOKEN_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
WEBEDIT_DATA_DIR="${TMPDIR:-/tmp}/webedit-dev" \
WEBEDIT_TEST_FIXTURES="$fixtures" \
exec ./bin/webedit
