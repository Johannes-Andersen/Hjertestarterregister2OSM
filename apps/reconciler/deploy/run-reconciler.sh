#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"

cd "$REPO_ROOT"

if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    . "$NVM_DIR/nvm.sh"
    if [[ -f "$REPO_ROOT/.nvmrc" ]]; then
      nvm use --silent >/dev/null
    fi
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node not found in PATH and nvm setup failed" >&2
  exit 127
fi

# auto-update. Disabled for now
# git pull --ff-only origin main
# pnpm install --frozen-lockfile

NODE_BIN="$(command -v node)"
exec "$NODE_BIN" --env-file="$REPO_ROOT/apps/reconciler/.env" "$REPO_ROOT/apps/reconciler/src/index.ts"
