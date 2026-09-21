#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

FAKE_BIN="$WORKDIR/bin"
STATE_DIR="$WORKDIR/state"
PODMAN_LOG="$WORKDIR/podman.log"
mkdir -p "$FAKE_BIN" "$STATE_DIR"

HALOGEN_CONFIG="$WORKDIR/halogen.json"
CONFIGURED_CONFIG="$WORKDIR/configured.json"
REMOTE_CONFIG="$WORKDIR/remote.json"
LOCAL_CONFIG="$WORKDIR/local.json"
printf '%s\n' '{"server":{"attach":{"mode":"endpoint","baseUrl":"http://127.0.0.1:8731/v1"}}}' > "$HALOGEN_CONFIG"
printf '%s\n' '{"server":{"endpoints":[{"baseUrl":"http://127.0.0.1:8731/v1"}],"attach":{"mode":"local"}}}' > "$CONFIGURED_CONFIG"
printf '%s\n' '{"server":{"attach":{"mode":"endpoint","baseUrl":"http://host.lan:8731/v1"}}}' > "$REMOTE_CONFIG"
printf '%s\n' '{"server":{"attach":{"mode":"local"}}}' > "$LOCAL_CONFIG"

for container in halogen-flash-server_api_1 halogen-flash-server_engine_1; do
  printf 'false\n' > "$STATE_DIR/$container"
done

cat > "$FAKE_BIN/podman" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "$1" in
  container)
    [[ "$2" == "exists" && -f "$FAKE_PODMAN_STATE/$3" ]]
    ;;
  inspect)
    cat "$FAKE_PODMAN_STATE/${@: -1}"
    ;;
  start|stop)
    action="$1"
    shift
    printf '%s %s\n' "$action" "$*" >> "$FAKE_PODMAN_LOG"
    for container in "$@"; do
      [[ -f "$FAKE_PODMAN_STATE/$container" ]]
      if [[ "$action" == "start" ]]; then
        printf 'true\n' > "$FAKE_PODMAN_STATE/$container"
      else
        printf 'false\n' > "$FAKE_PODMAN_STATE/$container"
      fi
    done
    ;;
  logs)
    exit 0
    ;;
  *)
    echo "unexpected podman invocation: $*" >&2
    exit 2
    ;;
esac
EOF
chmod +x "$FAKE_BIN/podman"

run_lifecycle() {
  PATH="$FAKE_BIN:$PATH" \
    FAKE_PODMAN_STATE="$STATE_DIR" \
    FAKE_PODMAN_LOG="$PODMAN_LOG" \
    timeout 2s bash "$ROOT/scripts/halogen_attach_stub.sh" "$1"
}

echo "[1/5] riconoscimento di Halogen attivo o configurato prima del picker"
timeout 2s bash "$ROOT/scripts/halogen_attach_stub.sh" configured "$HALOGEN_CONFIG"
timeout 2s bash "$ROOT/scripts/halogen_attach_stub.sh" configured "$CONFIGURED_CONFIG"
timeout 2s bash "$ROOT/scripts/halogen_attach_stub.sh" configured "$ROOT/frontend/ds4-ui.halogen.config.json"
if bash "$ROOT/scripts/halogen_attach_stub.sh" configured "$REMOTE_CONFIG"; then
  echo "FAIL: endpoint remoto riconosciuto come Halogen locale" >&2
  exit 1
fi
if bash "$ROOT/scripts/halogen_attach_stub.sh" configured "$LOCAL_CONFIG"; then
  echo "FAIL: backend locale riconosciuto come Halogen" >&2
  exit 1
fi

echo "[2/5] avvio dei container Halogen fermi"
run_lifecycle start
grep -qxF 'start halogen-flash-server_api_1 halogen-flash-server_engine_1' "$PODMAN_LOG"
grep -qxF true "$STATE_DIR/halogen-flash-server_api_1"
grep -qxF true "$STATE_DIR/halogen-flash-server_engine_1"

echo "[3/5] secondo avvio idempotente"
run_lifecycle start
[[ "$(grep -c '^start ' "$PODMAN_LOG")" == "1" ]]

echo "[4/5] arresto dei container Halogen"
run_lifecycle stop
grep -qxF 'stop halogen-flash-server_api_1 halogen-flash-server_engine_1' "$PODMAN_LOG"
grep -qxF false "$STATE_DIR/halogen-flash-server_api_1"
grep -qxF false "$STATE_DIR/halogen-flash-server_engine_1"

echo "[5/5] secondo arresto idempotente"
run_lifecycle stop
[[ "$(grep -c '^stop ' "$PODMAN_LOG")" == "1" ]]

echo "srun.sh Halogen container lifecycle certification: PASS"
