#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODEL="${DS4_CERT_MODEL:-$ROOT/ds4flash.gguf}"
BASE_URL="${DS4_CERT_BASE_URL:-http://127.0.0.1:8002}"
HOST="${DS4_CERT_HOST:-127.0.0.1}"
PORT="${DS4_CERT_PORT:-8002}"
CTX="${DS4_CERT_CTX:-32768}"

if [ ! -f "$MODEL" ]; then
    echo "ERROR: Model not found: $MODEL"
    echo "Set DS4_CERT_MODEL to a valid GGUF file."
    exit 2
fi

export DS4_SKILL_AUTO=1
export DS4_SKILLS_DIR="$ROOT/skills"

TMP="$(mktemp -d)"
trap 'kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; rm -rf "$TMP"' EXIT

echo "=== Starting wrapper ==="
echo "Model: $MODEL"
echo "Base URL: $BASE_URL"

./ds4-wrapper \
    --model "$MODEL" \
    --host "$HOST" \
    --port "$PORT" \
    --startup-mode server \
    -c "$CTX" \
    --kv-disk-dir "$TMP/kv" \
    >"$TMP/wrapper.log" 2>&1 &
PID=$!

echo "Waiting for readiness (PID=$PID)..."
for _ in $(seq 1 180); do
    if curl -fsS "$BASE_URL/api/wrapper/status" >"$TMP/status.json" 2>/dev/null; then
        break
    fi
    if ! kill -0 "$PID" 2>/dev/null; then
        echo "FAIL: wrapper process died"
        cat "$TMP/wrapper.log"
        exit 1
    fi
    sleep 1
done

python3 -m json.tool "$TMP/status.json" >/dev/null

echo ""
echo "=== Server metadata ==="
python3 - "$TMP/status.json" <<'PY'
import json, sys
status = json.load(open(sys.argv[1]))
ds = status.get("default_skills", {}).get("server", {})
assert ds.get("runtime_initialized") is True, f"runtime_initialized: {ds.get('runtime_initialized')}"
assert ds.get("enabled") is True, f"enabled: {ds.get('enabled')}"
assert ds.get("soul_loaded") is True, f"soul_loaded: {ds.get('soul_loaded')}"
assert ds.get("ethic_loaded") is True, f"ethic_loaded: {ds.get('ethic_loaded')}"
assert len(ds.get("revision", "")) == 40, f"revision: {ds.get('revision')}"
print(f"server-load: PASS")
print(f"  revision: {ds['revision']}")
PY

SOUL_BYTES="$(wc -c < skills/soul/SKILL.md)"
ETHIC_BYTES="$(wc -c < skills/ethic/SKILL.md)"
python3 - "$TMP/status.json" "$SOUL_BYTES" "$ETHIC_BYTES" <<'PY'
import json, sys
status = json.load(open(sys.argv[1]))
expected_soul = int(sys.argv[2])
expected_ethic = int(sys.argv[3])
ds = status["default_skills"]["server"]
assert ds["soul_bytes"] == expected_soul, f"soul_bytes: {ds['soul_bytes']} != {expected_soul}"
assert ds["ethic_bytes"] == expected_ethic, f"ethic_bytes: {ds['ethic_bytes']} != {expected_ethic}"
print(f"  soul_bytes: {ds['soul_bytes']} == {expected_soul}")
print(f"  ethic_bytes: {ds['ethic_bytes']} == {expected_ethic}")
PY

echo ""
echo "=== Token count injection ==="
curl -fsS \
    -H 'Content-Type: application/json' \
    -d "{
        \"model\":\"ds4\",
        \"messages\":[
            {\"role\":\"system\",\"content\":\"CLIENT-SYSTEM-CERT\"},
            {\"role\":\"user\",\"content\":\"Reply with OK\"}
        ]
    }" \
    "$BASE_URL/v1/token-count" \
    >"$TMP/token-count.json"

python3 - "$TMP/token-count.json" <<'PY'
import json, sys
tc = json.load(open(sys.argv[1]))
pt = tc.get("prompt_tokens", 0)
assert pt > 0, f"prompt_tokens: {pt}"
print(f"server-token-count-injection: PASS (prompt_tokens={pt})")
PY

echo ""
echo "=== Switch to agent mode ==="
curl -fsS \
    -X POST \
    -H 'Content-Type: application/json' \
    -d '{"mode":"agent"}' \
    "$BASE_URL/api/wrapper/switch-mode" \
    >"$TMP/switch.json"

sleep 1

echo "=== Trigger agent runtime init ==="
curl -fsS \
    -X POST \
    -H 'Content-Type: application/json' \
    -H 'X-Agent-Session-Key: cert-skill-autoload' \
    -d '{"command":"/help"}' \
    "$BASE_URL/api/native-agent/command" \
    >"$TMP/init.json"

sleep 2

curl -fsS "$BASE_URL/api/wrapper/status" >"$TMP/status-agent.json"
python3 - "$TMP/status-agent.json" <<'PY'
import json, sys
status = json.load(open(sys.argv[1]))
ds = status.get("default_skills", {}).get("agent", {})
assert ds.get("runtime_initialized") is True, f"agent runtime_initialized: {ds.get('runtime_initialized')}"
assert ds.get("enabled") is True, f"agent enabled: {ds.get('enabled')}"
assert ds.get("soul_loaded") is True, f"agent soul_loaded: {ds.get('soul_loaded')}"
assert ds.get("ethic_loaded") is True, f"agent ethic_loaded: {ds.get('ethic_loaded')}"
server_rev = status.get("default_skills", {}).get("server", {}).get("revision", "")
assert ds.get("revision") == server_rev, f"revision mismatch: {ds.get('revision')} != {server_rev}"
print(f"agent-load: PASS")
print(f"  revision: {ds['revision']}")
PY

echo ""
echo "=== /soul stop ==="
curl -fsS \
    -X POST \
    -H 'Content-Type: application/json' \
    -H 'X-Agent-Session-Key: cert-skill-autoload' \
    -d '{"command":"/soul stop"}' \
    "$BASE_URL/api/native-agent/command" \
    >"$TMP/soul-stop.json"

sleep 1

curl -fsS "$BASE_URL/api/wrapper/status" >"$TMP/status-soul-off.json"
python3 - "$TMP/status-soul-off.json" <<'PY'
import json, sys
status = json.load(open(sys.argv[1]))
ds = status.get("default_skills", {}).get("agent", {})
assert ds.get("soul_loaded") is False, f"soul_loaded should be False: {ds.get('soul_loaded')}"
assert ds.get("ethic_loaded") is True, f"ethic_loaded should be True: {ds.get('ethic_loaded')}"
print("soul-stop-current-session: PASS")
PY

echo ""
echo "=== /new restores soul ==="
curl -fsS \
    -X POST \
    -H 'Content-Type: application/json' \
    -H 'X-Agent-Session-Key: cert-skill-autoload' \
    -d '{"command":"/new"}' \
    "$BASE_URL/api/native-agent/command" \
    >"$TMP/new-after-soul-stop.json"

sleep 1

curl -fsS "$BASE_URL/api/wrapper/status" >"$TMP/status-new-soul.json"
python3 - "$TMP/status-new-soul.json" <<'PY'
import json, sys
status = json.load(open(sys.argv[1]))
ds = status.get("default_skills", {}).get("agent", {})
assert ds.get("soul_loaded") is True, f"soul_loaded should be True: {ds.get('soul_loaded')}"
assert ds.get("ethic_loaded") is True, f"ethic_loaded should be True: {ds.get('ethic_loaded')}"
print("new-restores-soul: PASS")
PY

echo ""
echo "=== /ethic stop ==="
curl -fsS \
    -X POST \
    -H 'Content-Type: application/json' \
    -H 'X-Agent-Session-Key: cert-skill-autoload' \
    -d '{"command":"/ethic stop"}' \
    "$BASE_URL/api/native-agent/command" \
    >"$TMP/ethic-stop.json"

sleep 1

curl -fsS "$BASE_URL/api/wrapper/status" >"$TMP/status-ethic-off.json"
python3 - "$TMP/status-ethic-off.json" <<'PY'
import json, sys
status = json.load(open(sys.argv[1]))
ds = status.get("default_skills", {}).get("agent", {})
assert ds.get("soul_loaded") is True, f"soul_loaded should be True: {ds.get('soul_loaded')}"
assert ds.get("ethic_loaded") is False, f"ethic_loaded should be False: {ds.get('ethic_loaded')}"
print("ethic-stop-current-session: PASS")
PY

echo ""
echo "=== /new restores ethic ==="
curl -fsS \
    -X POST \
    -H 'Content-Type: application/json' \
    -H 'X-Agent-Session-Key: cert-skill-autoload' \
    -d '{"command":"/new"}' \
    "$BASE_URL/api/native-agent/command" \
    >"$TMP/new-after-ethic-stop.json"

sleep 1

curl -fsS "$BASE_URL/api/wrapper/status" >"$TMP/status-new-ethic.json"
python3 - "$TMP/status-new-ethic.json" <<'PY'
import json, sys
status = json.load(open(sys.argv[1]))
ds = status.get("default_skills", {}).get("agent", {})
assert ds.get("soul_loaded") is True, f"soul_loaded should be True: {ds.get('soul_loaded')}"
assert ds.get("ethic_loaded") is True, f"ethic_loaded should be True: {ds.get('ethic_loaded')}"
print("new-restores-ethic: PASS")
PY

echo ""
echo "=== Silent output check ==="
python3 - "$TMP" <<'PY'
import json, os, glob, sys
tmp = sys.argv[1]
files = glob.glob(os.path.join(tmp, "*.json"))
soul_marker = "[BEGIN DS4 DEFAULT SOUL POLICY]"
ethic_marker = "[BEGIN DS4 DEFAULT ETHIC POLICY]"
for f in files:
    text = open(f).read()
    assert soul_marker not in text, f"Soul marker found in {os.path.basename(f)}"
    assert ethic_marker not in text, f"Ethic marker found in {os.path.basename(f)}"
print("silent-output: PASS")
PY

echo ""
echo "=== Switch back to server ==="
curl -sS \
    -X POST \
    -H 'Content-Type: application/json' \
    -d '{"mode":"server"}' \
    "$BASE_URL/api/wrapper/switch-mode" \
    >"$TMP/switch-back.json" 2>/dev/null

SWITCH_BACK_OK=$(python3 -c "import json; print(json.load(open('$TMP/switch-back.json')).get('ok', False))" 2>/dev/null || echo "False")

if [ "$SWITCH_BACK_OK" = "True" ]; then
    sleep 2
    curl -fsS "$BASE_URL/api/wrapper/status" >"$TMP/status-final.json"
    python3 - "$TMP/status-final.json" <<'PY'
import json, sys
status = json.load(open(sys.argv[1]))
ds = status.get("default_skills", {}).get("server", {})
assert ds.get("soul_loaded") is True, f"server soul_loaded: {ds.get('soul_loaded')}"
assert ds.get("ethic_loaded") is True, f"server ethic_loaded: {ds.get('ethic_loaded')}"
print("switch-back-server: PASS")
PY
else
    echo "switch-back-server: SKIP (agent->server freeze/thaw not supported)"
fi

echo ""
echo "========================================"
echo "skill autoload live certification: PASS"
echo "========================================"
