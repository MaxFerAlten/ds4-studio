#!/bin/sh
# Vitronia (llama.cpp Vulkan fork + Qwen3.8 Flash Next Q5K/MTP) as a managed
# endpoint, the native-process sibling of halogen_attach_stub.sh.
#
# Halogen lives in podman containers; Vitronia is a plain llama-server that
# $VITRONIA_DIR/srun.sh builds, verifies and execs. DS4 starts it detached
# (setsid) so restarting the frontend never takes the model down, remembers the
# pid, and tees its output into a log file that the default "logs" mode follows
# for the UI log panel -- same contract as the Halogen stub.
#
# It listens on 8732, not Vitronia's own default 8080: 8080 is already the
# agno/evolution model URL in ds4-ui.config.json.
#
# Overrides:
#   DS4_VITRONIA_DIR        checkout holding srun.sh (default /mnt/crucial_ai/COPARATOR/vitronia)
#   DS4_VITRONIA_PORT       listen port (default 8732; must match the endpoint baseUrl)
#   DS4_VITRONIA_STATE_DIR  pid + log location (default ~/.local/state/ds4-studio)
#   DS4_VITRONIA_FLUSH_SWAP 1 (default) flushes swap and sets swappiness=10 before
#                           the launch, asking for the sudo password on the
#                           terminal; 0 skips it
# Every other Vitronia knob (CONTEXT, SPEC_N_MAX, UBATCH, CACHE_RAM, LOAD_MODE,
# GPU_HIGH, ...) is read by Vitronia's srun.sh straight from the environment.
# CACHE_RAM defaults to 8192 MiB here, not Vitronia's 32768: next to ~88 GiB
# of weights the 32 GiB prompt cache pushed 43 GiB into swap before an amdgpu
# ring timeout.  CACHE_RAM=32768 ./srun.sh restores the old size.

VITRONIA_DIR="${DS4_VITRONIA_DIR:-/mnt/crucial_ai/COPARATOR/vitronia}"
VITRONIA_PORT="${DS4_VITRONIA_PORT:-8732}"
STATE_DIR="${DS4_VITRONIA_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/ds4-studio}"
PID_FILE="$STATE_DIR/vitronia.pid"
LOG_FILE="$STATE_DIR/vitronia.log"

# llama-server logs every request; the frontend polls ds4-only endpoints every
# couple of seconds and they 404 forever. Same reasoning as the Halogen stub.
# Set DS4_ENDPOINT_LOG_NOISE='^$' to keep everything.
NOISE="${DS4_ENDPOINT_LOG_NOISE:-(GET|POST) /(api/(server/metrics|agent/compression-metrics|wrapper/status)|v1/(models|token-count)|health)[^ ]* [0-9.]+ (200|404)}"

idle() {
    echo "endpoint-logs: idling (no Vitronia log to follow)"
    exec sleep infinity
}

# Kernel start time of a pid (field 22 of /proc/pid/stat; comm may hold
# spaces, so count from after its closing paren).
start_time() {
    sed -n 's/.*) //p' "/proc/$1/stat" 2>/dev/null | cut -d' ' -f20
}

# Pid of the DS4-managed Vitronia, or nothing. The pid file stores
# "pid starttime": a bare pid can belong to anything after a reboot, and the
# cmdline cannot identify it either once srun.sh has exec'd llama-server.
managed_pid() {
    [ -f "$PID_FILE" ] || return 1
    read -r pid started < "$PID_FILE" 2>/dev/null || return 1
    case "$pid" in ''|*[!0-9]*) return 1 ;; esac
    [ -n "$started" ] && [ "$(start_time "$pid")" = "$started" ] || return 1
    echo "$pid"
}

vitronia_running() {
    managed_pid >/dev/null
}

# Vitronia's own srun.sh does this (FLUSH_SWAP=1): ~88 GiB of dio-loaded
# weights leave no headroom on a 128 GB Strix Halo, and pages left in swap get
# paged back in mid-decode, stalling generation. It needs sudo, and the server
# below runs detached with no terminal to prompt on, so it happens here, in the
# foreground of DS4's srun.sh, and Vitronia is then told to skip it.
flush_swap() {
    [ "${DS4_VITRONIA_FLUSH_SWAP:-1}" = "1" ] || return 0
    used_kb="$(awk '/SwapTotal/{t=$2} /SwapFree/{f=$2} END{print t-f}' /proc/meminfo)"
    avail_kb="$(awk '/MemAvailable/{print $2}' /proc/meminfo)"
    swappiness="$(cat /proc/sys/vm/swappiness)"
    [ "$used_kb" -gt 1048576 ] || [ "$swappiness" -gt 10 ] || return 0

    echo "endpoint-logs: swap cleanup before Vitronia: $((used_kb / 1024)) MB in use, swappiness=$swappiness"
    if [ "$(id -u)" = "0" ]; then
        sudo=""
    elif [ -t 0 ]; then
        sudo="sudo"
        sudo -v -p "[sudo] password for %u (swap cleanup before Vitronia): " || {
            echo "endpoint-logs: WARNING: no sudo; swap left as is, decode may stall on page-in" >&2
            return 0
        }
    else
        # No terminal (e.g. launched from a script): only passwordless sudo.
        sudo="sudo -n"
    fi
    $sudo sysctl -qw vm.swappiness=10 ||
        echo "endpoint-logs: WARNING: cannot set vm.swappiness" >&2
    [ "$used_kb" -gt 1048576 ] || return 0
    # swapoff pulls every swapped page back into RAM; without room for them
    # the kernel would start OOM-killing instead.
    if [ "$avail_kb" -lt $((used_kb + 4194304)) ]; then
        echo "endpoint-logs: WARNING: not enough free RAM to empty swap; skipped" >&2
        return 0
    fi
    { $sudo swapoff -a && $sudo swapon -a; } ||
        echo "endpoint-logs: WARNING: swap flush failed; decode may stall on page-in" >&2
}

vitronia_start() {
    if pid="$(managed_pid)"; then
        echo "endpoint-logs: Vitronia already running (pid $pid)"
        return 0
    fi
    [ -x "$VITRONIA_DIR/srun.sh" ] || [ -f "$VITRONIA_DIR/srun.sh" ] || {
        echo "endpoint-logs: no Vitronia launcher at $VITRONIA_DIR/srun.sh" >&2
        return 1
    }
    command -v setsid >/dev/null 2>&1 || {
        echo "endpoint-logs: setsid is required to start Vitronia" >&2
        return 1
    }
    # Vitronia's own order: preflight (GPU, disk, port, RAM) first, swap
    # cleanup after. A failing check then stops here, before any sudo prompt.
    if ! HOST=127.0.0.1 PORT="$VITRONIA_PORT" bash "$VITRONIA_DIR/srun.sh" --check </dev/null; then
        echo "endpoint-logs: Vitronia preflight failed; not starting" >&2
        return 1
    fi
    avail_before="$(awk '/MemAvailable/{print $2}' /proc/meminfo)"
    flush_swap
    avail_after="$(awk '/MemAvailable/{print $2}' /proc/meminfo)"
    # Swapped-in pages now count against MemAvailable, so the launch would
    # fail the RAM check that --check just passed. Lower it by what the flush
    # took back, rounded up to whole GiB, as Vitronia launched by hand would
    # never re-check after its own flush.
    min_ram="${MIN_RAM_GIB:-100}"
    reclaimed_gib=$(( (avail_before - avail_after + 1048575) / 1048576 ))
    [ "$reclaimed_gib" -gt 0 ] || reclaimed_gib=0
    min_ram=$((min_ram - reclaimed_gib))
    [ "$min_ram" -gt 0 ] || min_ram=0
    mkdir -p "$STATE_DIR" || return 1
    : > "$LOG_FILE"
    # setsid: own session and process group, so stop can signal the whole
    # tree (bash srun.sh, then the llama-server it execs) and the frontend's
    # process manager never reaps it. HOST is pinned: the stub only manages
    # the loopback endpoint.
    HOST=127.0.0.1 PORT="$VITRONIA_PORT" FLUSH_SWAP=0 MIN_RAM_GIB="$min_ram" \
      CACHE_RAM="${CACHE_RAM:-8192}" \
        setsid bash "$VITRONIA_DIR/srun.sh" >>"$LOG_FILE" 2>&1 </dev/null &
    pid=$!
    echo "$pid $(start_time "$pid")" > "$PID_FILE"
    # srun.sh refuses fast (busy port, <100 GiB free RAM, missing GPU) before
    # loading anything. Catch that here so srun.sh can report it, instead of
    # the frontend polling a server that will never come up.
    sleep 3
    if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$PID_FILE"
        echo "endpoint-logs: Vitronia exited during startup; last log lines:" >&2
        tail -n 15 "$LOG_FILE" >&2
        return 1
    fi
    echo "endpoint-logs: Vitronia starting (pid $pid, port $VITRONIA_PORT, log $LOG_FILE)"
}

vitronia_stop() {
    pid="$(managed_pid)" || { rm -f "$PID_FILE"; return 0; }
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    # llama-server unmaps ~90 GiB of weights on exit; give it time.
    i=0
    while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 60 ]; do
        sleep 0.5
        i=$((i + 1))
    done
    if kill -0 "$pid" 2>/dev/null; then
        echo "endpoint-logs: Vitronia ignored SIGTERM; killing" >&2
        kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
    fi
    rm -f "$PID_FILE"
}

# Shared by configured/selected: $2 = "configured" also accepts a Vitronia
# that is only listed in server.endpoints.
vitronia_config_check() {
    config="$1"
    which="$2"

    [ -f "$config" ] && command -v node >/dev/null 2>&1 || return 1

    node -e '
      const fs = require("fs");
      try {
        const [file, which, port] = process.argv.slice(1);
        const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
        const server = cfg?.server || {};
        const attach = server.attach || {};
        const isVitronia = value => {
          try {
            const endpoint = new URL(value);
            return endpoint.protocol === "http:" &&
              (endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost") &&
              endpoint.port === port;
          } catch { return false; }
        };
        if (which === "selected") {
          process.exit(attach.mode === "endpoint" && isVitronia(attach.baseUrl) ? 0 : 1);
        }
        const urls = [attach.baseUrl,
          ...(Array.isArray(server.endpoints) ? server.endpoints.map(e => e?.baseUrl) : [])];
        process.exit(urls.some(isVitronia) ? 0 : 1);
      } catch { process.exit(1); }
    ' "$config" "$which" "$VITRONIA_PORT" 2>/dev/null
}

case "${1:-logs}" in
    start)
        vitronia_start
        exit $?
        ;;
    stop)
        vitronia_stop
        exit $?
        ;;
    running)
        vitronia_running
        exit $?
        ;;
    configured|selected)
        vitronia_config_check "${2:-}" "$1"
        exit $?
        ;;
esac

# Wait briefly for a start that srun.sh may still be issuing.
i=0
while [ ! -f "$LOG_FILE" ] && [ "$i" -lt 10 ]; do
    sleep 1
    i=$((i + 1))
done
[ -f "$LOG_FILE" ] || idle

echo "endpoint-logs: following $LOG_FILE"
# -F: survives the truncation each start does. -n 0: live view, not a replay.
# sed -u / grep --line-buffered: stdout is always a pipe here (see Halogen stub).
exec sh -c 'tail -n 0 -F "$1" 2>/dev/null \
    | grep --line-buffered -v -E "$2" \
    | sed -u "s/^/[vitronia] /"' sh "$LOG_FILE" "$NOISE"
