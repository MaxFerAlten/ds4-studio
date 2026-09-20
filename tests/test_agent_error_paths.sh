#!/bin/sh
# test_agent_error_paths.sh - native agent failures must reach the client.
#
# Each case used to be masked: prepare said ready:true, chat returned an empty
# 200, or every later request said "busy" / "no active session" instead of the
# cause. Needs the GPU and a model (two wrapper launches, a few minutes).
#
#   DS4_TEST_MODEL=<gguf> DS4_TEST_PORT=8012 ./tests/test_agent_error_paths.sh

set -u
cd "$(dirname "$0")/.."

# The directory srun scans: DS4_MODELS_DIR, else server.modelsDir of the UI config.
MODELS_DIR="$(python3 -c 'import sys; sys.path.insert(0, "scripts"); import srun_model_scan as s; print(s.configured_models_dir() or "")')"
MODEL="${DS4_TEST_MODEL:-$MODELS_DIR/DeepSeek-V4-Flash-IQ2XXS-w2Q2K-AProjQ8-SExpQ8-OutQ8-chat-v2-imatrix.gguf}"
[ -f "$MODEL" ] || { echo "FAIL no test model at '$MODEL': set DS4_TEST_MODEL, or server.modelsDir / DS4_MODELS_DIR"; exit 1; }
PORT="${DS4_TEST_PORT:-8012}"
B="http://127.0.0.1:$PORT"
T="$(mktemp -d)"
PID=
fail=0

stop() { [ -n "$PID" ] && kill "$PID" 2>/dev/null && wait "$PID" 2>/dev/null; PID=; }
trap 'stop; rm -rf "$T"' EXIT INT TERM

# HOME is redirected so saved sessions and sysprompt.kv stay out of ~/.ds4.
start() {
    rm -rf "$T/kv"; mkdir -p "$T/home"
    HOME="$T/home" ./ds4-wrapper --model "$MODEL" --ctx "$1" --tokens 512 \
        --host 127.0.0.1 --port "$PORT" --startup-mode server \
        --kv-disk-dir "$T/kv" --kv-disk-space-mb 2048 --freeze-on-switch \
        --free-inactive-session --ram-freeze-max-mb 4096 > "$T/wrapper.log" 2>&1 &
    PID=$!
    curl -s -o /dev/null --retry 90 --retry-delay 2 --retry-all-errors -m 5 "$B/v1/models" ||
        { echo "FAIL wrapper did not start"; cat "$T/wrapper.log"; exit 1; }
    post /api/wrapper/switch-mode '{"mode":"agent"}' > /dev/null
}

post() { curl -s -N -m 900 "$B$1" -H 'Content-Type: application/json' -d "$2"; }

# expect <name> <needle> <reply>
expect() {
    case "$3" in
        *"$2"*) echo "ok   $1" ;;
        *) echo "FAIL $1"; echo "     expected: $2"; echo "     got: $(printf %s "$3" | tail -c 300)"; fail=1 ;;
    esac
}

echo "== system prompt does not fit (ctx 8192) =="
start 8192
expect "prepare reports the cause" "exceeds context 8192" "$(post /api/native-agent/prepare '{}')"
expect "chat reports it too, not 'no active session'" "exceeds context 8192" \
    "$(post /api/native-agent/chat '{"message":"ciao"}')"
expect "log names it" "agent init failed: prompt length" "$(cat "$T/wrapper.log")"
stop

echo "== skills outgrow the context (ctx 32768) =="
start 32768
expect "agent answers" "agent_done" "$(post /api/native-agent/chat '{"message":"rispondi solo: ok"}')"
post /api/native-agent/command '{"command":"/lean start"}' > /dev/null
post /api/native-agent/command '{"command":"/metacognition start"}' > /dev/null
expect "rebuild failure is an agent_error event" "event: agent_error" \
    "$(post /api/native-agent/chat '{"message":"ciao"}')"
expect "a retry repeats the cause, not 'busy'" "exceeds context 32768" \
    "$(post /api/native-agent/chat '{"message":"ciao"}')"
expect "the skill can still be stopped" '"ok":true' \
    "$(post /api/native-agent/command '{"command":"/metacognition stop"}')"
expect "and the agent recovers" "agent_done" "$(post /api/native-agent/chat '{"message":"rispondi solo: ok"}')"

echo "== a failed turn leaves the worker in error =="
post /api/native-agent/chat '{"message":"scrivi i numeri da 1 a 600 separati da virgola"}' > /dev/null
expect "next chat names the original error" "agent stopped after an error:" \
    "$(post /api/native-agent/chat '{"message":"ciao"}')"
post /api/native-agent/new '{}' > /dev/null
expect "a new session recovers" "agent_done" "$(post /api/native-agent/chat '{"message":"rispondi solo: ok"}')"
stop

echo
[ "$fail" -eq 0 ] && echo "test_agent_error_paths: PASS" || { echo "test_agent_error_paths: FAIL"; exit 1; }
