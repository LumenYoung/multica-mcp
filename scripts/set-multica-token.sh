#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="${HERMES_ENV_FILE:-/opt/data/.env}"
mkdir -p "$(dirname "$ENV_FILE")"
chmod 700 "$(dirname "$ENV_FILE")" 2>/dev/null || true
printf 'Paste MULTICA_TOKEN (input hidden): ' >&2
IFS= read -r -s TOKEN
printf '\n' >&2
if [[ -z "$TOKEN" ]]; then
  echo "Token was empty; aborting." >&2
  exit 2
fi
python3 - "$ENV_FILE" "$TOKEN" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
token = sys.argv[2]
lines = path.read_text().splitlines() if path.exists() else []
out = []
seen = False
for line in lines:
    if line.startswith('MULTICA_TOKEN='):
        if not seen:
            out.append('MULTICA_TOKEN=' + token)
            seen = True
        continue
    out.append(line)
if not seen:
    if out and out[-1].strip():
        out.append('')
    out.append('MULTICA_TOKEN=' + token)
path.write_text('\n'.join(out) + '\n')
PY
chmod 600 "$ENV_FILE"
echo "MULTICA_TOKEN saved to $ENV_FILE (value not printed). Restart Hermes or run /reload-mcp after this."
