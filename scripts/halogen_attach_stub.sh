#!/bin/sh
# ds4-ui spawns server.binary unconditionally at boot (index.mjs: manager.start()).
# In endpoint mode there is no engine to launch, but the process manager pipes
# this process's stdout/stderr into the ring buffer that /api/server/logs serves
# and the UI log panel renders. So instead of idling, follow the endpoint's own
# container logs: the panel then shows the backend that is actually answering,
# which an attached setup otherwise leaves blank.
#
# Falls back to idling whenever the logs cannot be followed -- the attach must
# keep working on a host with no podman, or against a remote endpoint.
#
# Override the containers with DS4_ENDPOINT_LOG_CONTAINERS (space separated).

CONTAINERS="${DS4_ENDPOINT_LOG_CONTAINERS:-halogen-flash-server_api_1 halogen-flash-server_engine_1}"

# The frontend polls ds4-only endpoints every couple of seconds. On an endpoint
# they 404 forever, and the access lines bury the throughput lines that are the
# reason to look at this panel at all. Dropped here, not hidden in the UI, so
# what reaches the ring buffer is already the signal.
# Set DS4_ENDPOINT_LOG_NOISE='^$' to keep everything.
NOISE="${DS4_ENDPOINT_LOG_NOISE:-\"(GET|POST) /(api/(server/metrics|agent/compression-metrics|wrapper/status)|v1/(models|token-count))[^\"]*\" (200|404)}"

idle() {
    echo "endpoint-logs: idling (no container logs to follow)"
    exec sleep infinity
}

container_lifecycle() {
    action="$1"
    command -v podman >/dev/null 2>&1 || {
        echo "endpoint-logs: podman is required to $action Halogen" >&2
        return 1
    }

    pending=""
    for c in $CONTAINERS; do
        if ! podman container exists "$c" 2>/dev/null; then
            echo "endpoint-logs: no container named $c" >&2
            return 1
        fi
        running="$(podman inspect --format '{{.State.Running}}' "$c")"
        if { [ "$action" = "start" ] && [ "$running" != "true" ]; } ||
           { [ "$action" = "stop" ] && [ "$running" = "true" ]; }; then
            pending="$pending $c"
        fi
    done

    [ -n "$pending" ] || return 0
    # Container names cannot contain spaces; intentional word splitting keeps
    # both names in one idempotent podman start/stop command.
    podman "$action" $pending
}

halogen_running() {
    command -v podman >/dev/null 2>&1 || return 1
    for c in $CONTAINERS; do
        podman container exists "$c" 2>/dev/null || return 1
    done
    for c in $CONTAINERS; do
        running="$(podman inspect --format '{{.State.Running}}' "$c" 2>/dev/null)" || return 1
        [ "$running" = "true" ] && return 0
    done
    return 1
}

halogen_configured() {
    config="$1"
    [ -f "$config" ] && command -v node >/dev/null 2>&1 || return 1
    node -e '
      const fs = require("fs");
      try {
        const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const server = cfg?.server || {};
        const urls = [server.attach?.baseUrl,
          ...(Array.isArray(server.endpoints) ? server.endpoints.map(e => e?.baseUrl) : [])];
        const isHalogen = value => {
          try {
            const endpoint = new URL(value);
            return endpoint.protocol === "http:" &&
              (endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost") &&
              endpoint.port === "8731";
          } catch { return false; }
        };
        const legacy = String(server.binary || "").endsWith("halogen_attach_stub.sh") &&
          (server.host === "127.0.0.1" || server.host === "localhost") &&
          Number(server.port) === 8731;
        process.exit(urls.some(isHalogen) || legacy ? 0 : 1);
      } catch { process.exit(1); }
    ' "$config" 2>/dev/null
}

halogen_selected() {
    config="$1"
    [ -f "$config" ] && command -v node >/dev/null 2>&1 || return 1
    node -e '
      const fs = require("fs");
      try {
        const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const server = cfg?.server || {};
        const attach = server.attach || {};
        let attached = false;
        try {
          const endpoint = new URL(attach.baseUrl);
          attached = attach.mode === "endpoint" &&
            endpoint.protocol === "http:" &&
            (endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost") &&
            endpoint.port === "8731";
        } catch {}
        const legacy = !attach.mode &&
          String(server.binary || "").endsWith("halogen_attach_stub.sh") &&
          (server.host === "127.0.0.1" || server.host === "localhost") &&
          Number(server.port) === 8731;
        const selected = attached || legacy;
        process.exit(selected ? 0 : 1);
      } catch { process.exit(1); }
    ' "$config" 2>/dev/null
}

case "${1:-logs}" in
    start|stop)
        container_lifecycle "$1"
        exit $?
        ;;
    running)
        halogen_running
        exit $?
        ;;
    configured)
        halogen_configured "${2:-}"
        exit $?
        ;;
    selected)
        halogen_selected "${2:-}"
        exit $?
        ;;
esac

command -v podman >/dev/null 2>&1 || idle

# Only follow containers that exist; a name that never appears would spin.
present=""
for c in $CONTAINERS; do
    if podman container exists "$c" 2>/dev/null; then
        present="$present $c"
    else
        echo "endpoint-logs: no container named $c"
    fi
done
[ -n "$present" ] || idle

pids=""
cleanup() { [ -n "$pids" ] && kill $pids 2>/dev/null; exit 0; }
trap cleanup INT TERM

for c in $present; do
    short="${c##*_}"
    short="${c%_1}"; short="${short##*_}"
    echo "endpoint-logs: following $c"
    # --since 1s: the panel is a live view, not a replay of an hour of history.
    ( while :; do
          # sed -u: without it sed block-buffers when stdout is a pipe (which it
          # always is here, the process manager pipes it), so lines sat in a 4K
          # buffer instead of reaching the log panel.
          podman logs -f --since 1s "$c" 2>&1 \
              | grep --line-buffered -v -E "$NOISE" \
              | sed -u "s/^/[$short] /"
          echo "[$short] log stream ended; retrying in 5s"
          sleep 5
      done ) &
    pids="$pids $!"
done

wait
