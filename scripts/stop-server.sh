#!/bin/sh
# Stops whatever webedit is listening on one port: by default the e2e
# server (18080), so a dev server on 8080 keeps running.
#
# Usage: scripts/stop-server.sh [port]
#
# Use this instead of `pkill -f bin/webedit`: that pattern also matches the
# shell running the pkill, and kills it.
set -eu
port="${1:-${E2E_PORT:-18080}}"
pids=$(lsof -t -iTCP:"$port" -sTCP:LISTEN || true)
if [ -z "$pids" ]; then
  echo "Nothing is listening on port $port."
  exit 0
fi
kill $pids
echo "Stopped $pids on port $port."
