#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"

cd "$REPO_ROOT"

# auto-update. Disabled for now
# git pull --ff-only origin main
# pnpm install --frozen-lockfile

exec node --env-file="$REPO_ROOT/apps/reconciler/.env" "$REPO_ROOT/apps/reconciler/src/index.ts"
