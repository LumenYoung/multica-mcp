#!/usr/bin/env bash
set -euo pipefail
cd /workspace/repos/multica-mcp
npm run build >/dev/null
set -a
source /opt/data/.env
set +a
: "${MULTICA_TOKEN:?MULTICA_TOKEN missing in /opt/data/.env}"
MULTICA_API_BASE_URL="${MULTICA_API_BASE_URL:-https://kanban-api.lumeny.io}" \
MULTICA_WEB_BASE_URL="${MULTICA_WEB_BASE_URL:-https://kanban.lumeny.io}" \
MULTICA_TOKEN="$MULTICA_TOKEN" \
node scripts/e2e-mcp-smoke.mjs
