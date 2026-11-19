#!/usr/bin/env bash
# Checks that code and the design docs agree:
#  1. No source file uses a term GLOSSARY.md lists under _Avoid_.
#  2. Every API error code in the Go server is in the spec's closed list.
# Run by `make check-fast` (and so by the pre-commit hook).
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
sources=(web/src web/e2e internal cmd)
includes=(--include=*.ts --include=*.tsx --include=*.go)

# --- 1. Glossary _Avoid_ terms ---------------------------------------------
# Terms that are also ordinary code identifiers (the DOM's `document`, CSS
# `outline`, Go's `bytes.Buffer`...) can't be grepped for; reviewers catch those.
skip='^(project|dropbox|document|user|admin|buffer|outline)$'
mapfile -t terms < <(
  sed -n 's/^_Avoid_: *//p' GLOSSARY.md |
    sed 's/([^)]*)//g' | tr ',' '\n' | sed 's/^ *//; s/ *$//' |
    grep -v '^$' | grep -viE "$skip"
)
# Near-synonyms of an Avoid term that the term itself doesn't match.
terms+=("unsaved work" "unsaved edits")

for t in "${terms[@]}"; do
  if hits=$(grep -rniw "${includes[@]}" -e "$t" "${sources[@]}"); then
    echo "GLOSSARY.md says to avoid \"$t\" (see its _Avoid_ lines for the term to use):"
    echo "$hits" | sed 's/^/  /'
    fail=1
  fi
done

# --- 2. Error codes vs the spec ---------------------------------------------
spec=.scratch/webedit/spec.md
spec_codes=$(grep -m1 'The codes are:' "$spec" |
  sed 's/.*The codes are: *//; s/([^)]*)//g; s/ *\. .*//; s/\.$//' |
  tr ',' '\n' | sed 's/^ *//; s/ *$//' | grep -v '^$' | sort -u)
code_codes=$(
  {
    grep -rhoE --include=*.go 'Code: *"[a-z-]+"' internal | grep -oE '"[a-z-]+"'
    sed -n '/^var errorCodes = map/,/^}/p' internal/server/server.go | grep -oE '"[a-z-]+"'
  } | tr -d '"' | sort -u
)
if missing=$(comm -23 <(echo "$code_codes") <(echo "$spec_codes")) && [ -n "$missing" ]; then
  echo "Error codes used in internal/ but missing from the closed list in $spec (\"The codes are:\"):"
  echo "$missing" | sed 's/^/  /'
  fail=1
fi

exit $fail
