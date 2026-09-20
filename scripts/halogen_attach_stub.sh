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

CONTAINERS="${DS4_ENDPOINT_LOG_CONTAINERS:-halogen-flash-server_engine_1 halogen-flash-server_api_1}"

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
