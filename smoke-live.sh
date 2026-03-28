#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:18000}"
PROXY_API_KEY="${PROXY_API_KEY:-dev-secret}"
MODEL="${MODEL:-claude-sonnet-4.6}"

echo "[1/3] GET /v1/models"
curl -f -sS -D - "${BASE_URL}/v1/models" \
  -H "Authorization: Bearer ${PROXY_API_KEY}" \
  -o /tmp/kiro_proxy_models.json
echo
echo "models body (first 400 chars):"
python3 - <<'PY'
from pathlib import Path
text = Path("/tmp/kiro_proxy_models.json").read_text(errors="replace")
print(text[:400])
PY
echo

echo "[2/3] POST /v1/chat/completions (stream)"
curl -f --max-time 30 -sS -D - -N "${BASE_URL}/v1/chat/completions" \
  -H "Authorization: Bearer ${PROXY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"${MODEL}\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}"
echo

echo "[3/3] POST /v1/messages (stream)"
curl -f --max-time 30 -sS -D - -N "${BASE_URL}/v1/messages" \
  -H "x-api-key: ${PROXY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"${MODEL}\",\"max_tokens\":64,\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"ping\"}]}]}"
echo

echo "Smoke live finished."
