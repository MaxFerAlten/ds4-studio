#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
STUB="$ROOT/scripts/vitronia_attach_stub.sh"

# A fake Vitronia checkout: srun.sh records its environment and then idles
# like llama-server would, or refuses at once when FAKE_VITRONIA_FAIL is set.
FAKE_VITRONIA="$WORKDIR/vitronia"
mkdir -p "$FAKE_VITRONIA"
cat > "$FAKE_VITRONIA/srun.sh" <<'EOF'
set -euo pipefail
if [[ "${1:-}" == "--check" ]]; then
  echo "fake check PORT=$PORT" >> "$FAKE_VITRONIA_CALLS"
  if [[ -n "${FAKE_VITRONIA_CHECK_FAIL:-}" ]]; then
    echo "RAM disponibile: 91.4 GiB" >&2
    exit 1
  fi
  exit 0
fi
echo "fake run" >> "$FAKE_VITRONIA_CALLS"
echo "fake vitronia HOST=$HOST PORT=$PORT FLUSH_SWAP=$FLUSH_SWAP MIN_RAM_GIB=$MIN_RAM_GIB CACHE_RAM=$CACHE_RAM"
if [[ -n "${FAKE_VITRONIA_FAIL:-}" ]]; then
  echo "Porta 127.0.0.1:$PORT non disponibile" >&2
  exit 1
fi
exec sleep 300
EOF

export DS4_VITRONIA_DIR="$FAKE_VITRONIA"
export DS4_VITRONIA_STATE_DIR="$WORKDIR/state"
# Never touch the real swap (or prompt for sudo) from the test.
export DS4_VITRONIA_FLUSH_SWAP=0
export FAKE_VITRONIA_CALLS="$WORKDIR/calls"
trap 'bash "$STUB" stop >/dev/null 2>&1 || true; rm -rf "$WORKDIR"' EXIT

SELECTED_CONFIG="$WORKDIR/selected.json"
CONFIGURED_CONFIG="$WORKDIR/configured.json"
HALOGEN_CONFIG="$WORKDIR/halogen.json"
REMOTE_CONFIG="$WORKDIR/remote.json"
printf '%s\n' '{"server":{"attach":{"mode":"endpoint","baseUrl":"http://127.0.0.1:8732/v1"}}}' > "$SELECTED_CONFIG"
printf '%s\n' '{"server":{"endpoints":[{"baseUrl":"http://localhost:8732/v1"}],"attach":{"mode":"local"}}}' > "$CONFIGURED_CONFIG"
printf '%s\n' '{"server":{"attach":{"mode":"endpoint","baseUrl":"http://127.0.0.1:8731/v1"}}}' > "$HALOGEN_CONFIG"
printf '%s\n' '{"server":{"attach":{"mode":"endpoint","baseUrl":"http://box.lan:8732/v1"}}}' > "$REMOTE_CONFIG"

fail() { echo "FAIL: $*" >&2; exit 1; }

echo "[1/6] distinzione fra Vitronia configurato e selezionato"
bash "$STUB" configured "$SELECTED_CONFIG"
bash "$STUB" configured "$CONFIGURED_CONFIG"
bash "$STUB" configured "$ROOT/frontend/ds4-ui.config.json"
bash "$STUB" selected "$SELECTED_CONFIG"
! bash "$STUB" selected "$CONFIGURED_CONFIG" || fail "Vitronia solo elencato riconosciuto come selezionato"
! bash "$STUB" selected "$HALOGEN_CONFIG" || fail "Halogen riconosciuto come Vitronia"
! bash "$STUB" configured "$REMOTE_CONFIG" || fail "endpoint remoto riconosciuto come Vitronia locale"
! "$ROOT/scripts/halogen_attach_stub.sh" selected "$SELECTED_CONFIG" || fail "Vitronia riconosciuto come Halogen"

echo "[2/6] avvio staccato del server"
! bash "$STUB" running || fail "Vitronia fermo riconosciuto come attivo"
bash "$STUB" start
bash "$STUB" running
grep -qxF "fake vitronia HOST=127.0.0.1 PORT=8732 FLUSH_SWAP=0 MIN_RAM_GIB=100 CACHE_RAM=8192" "$DS4_VITRONIA_STATE_DIR/vitronia.log"
# Preflight runs before the launch, as in Vitronia's own srun.sh.
[[ "$(cat "$FAKE_VITRONIA_CALLS")" == $'fake check PORT=8732\nfake run' ]] || fail "preflight non eseguito prima dell'avvio"
read -r pid _ < "$DS4_VITRONIA_STATE_DIR/vitronia.pid"
[[ "$(ps -o pgid= -p "$pid" | tr -d ' ')" == "$pid" ]] || fail "Vitronia non ha un process group proprio"

echo "[3/6] secondo avvio idempotente"
bash "$STUB" start | grep -q "already running"
read -r again _ < "$DS4_VITRONIA_STATE_DIR/vitronia.pid"
[[ "$again" == "$pid" ]]

echo "[4/6] arresto del server"
bash "$STUB" stop
! kill -0 "$pid" 2>/dev/null || fail "processo Vitronia ancora vivo"
! bash "$STUB" running || fail "Vitronia arrestato riconosciuto come attivo"
bash "$STUB" stop

echo "[5/6] errore di avvio riportato a srun.sh"
if FAKE_VITRONIA_FAIL=1 bash "$STUB" start 2>"$WORKDIR/err"; then
  fail "avvio fallito riportato come riuscito"
fi
grep -q "non disponibile" "$WORKDIR/err"
[[ ! -f "$DS4_VITRONIA_STATE_DIR/vitronia.pid" ]] || fail "pid file lasciato dopo un avvio fallito"

: > "$FAKE_VITRONIA_CALLS"
if FAKE_VITRONIA_CHECK_FAIL=1 bash "$STUB" start 2>"$WORKDIR/err"; then
  fail "preflight fallito riportato come riuscito"
fi
grep -q "preflight failed" "$WORKDIR/err"
! grep -q "fake run" "$FAKE_VITRONIA_CALLS" || fail "avviato nonostante il preflight fallito"

echo "[6/6] pid file estraneo non viene ucciso"
sleep 300 &
foreign=$!
# Recycled pid: same number, different start time.
echo "$foreign 1" > "$DS4_VITRONIA_STATE_DIR/vitronia.pid"
! bash "$STUB" running || fail "processo estraneo riconosciuto come Vitronia"
bash "$STUB" stop
kill -0 "$foreign" || fail "stop ha ucciso un processo estraneo"
kill "$foreign"

echo "srun.sh Vitronia server lifecycle certification: PASS"
