#!/bin/sh
# Starts the real binary in test mode for Playwright, with the fake Dropbox
# seeded from e2e/fixtures plus generated files that shouldn't live in git:
# one over 5 MB and one that isn't valid UTF-8. Run from the repo root.
set -eu
data="$WEBEDIT_DATA_DIR"
fixtures="$data/fixtures"
rm -rf "$fixtures"
mkdir -p "$data"
cp -R web/e2e/fixtures "$fixtures"
head -c 5300000 /dev/zero | tr '\0' 'a' > "$fixtures/big.log"
printf 'caf\351 au lait\n' > "$fixtures/Notes/latin1.txt"
go build -o bin/webedit ./cmd/webedit
WEBEDIT_TEST_FIXTURES="$fixtures" exec ./bin/webedit
