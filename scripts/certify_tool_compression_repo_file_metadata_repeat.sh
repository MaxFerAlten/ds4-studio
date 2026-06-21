#!/usr/bin/env bash
set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${1:-docs/certifications}"
mkdir -p "$OUT_DIR"
RAW="$OUT_DIR/tool_compression_repo_file_metadata_repeat.tsv"
REPORT="$OUT_DIR/tool_compression_repo_file_metadata_repeat.md"
BIN="$(mktemp /tmp/ds4_tool_compression_token_probe.XXXXXX)"
WORK="$(mktemp -d /tmp/ds4_tool_compression_metadata_repeat.XXXXXX)"
SERVER_PID=""
trap 'if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi; rm -rf "$BIN" "$WORK"' EXIT

DS4_BIN="${DS4_BIN:-./ds4}"
DS4_SERVER_BIN="${DS4_SERVER_BIN:-./ds4-server}"
DS4_BACKEND="${DS4_BACKEND:-rocm}"
DS4_METADATA_REPEAT_N="${DS4_METADATA_REPEAT_N:-5}"
DS4_METADATA_REPEAT_SEED="${DS4_METADATA_REPEAT_SEED:-20260621}"
DS4_METADATA_REQUEST_TIMEOUT="${DS4_METADATA_REQUEST_TIMEOUT:-900}"
DS4_METADATA_IDLE_WAIT_TIMEOUT="${DS4_METADATA_IDLE_WAIT_TIMEOUT:-900}"
DS4_METADATA_MAX_TOKENS="${DS4_METADATA_MAX_TOKENS:-8}"
DS4_METADATA_BASE_URL="${DS4_METADATA_BASE_URL:-${DS4_OPERATIONAL_BASE_URL:-}}"
DS4_METADATA_CTX="${DS4_METADATA_CTX:-32768}"
DS4_SERVER_START_TIMEOUT="${DS4_SERVER_START_TIMEOUT:-300}"
CC_BIN="${CC:-cc}"
CFLAGS_LOCAL="${CFLAGS:-}"

if [ ! -x "$DS4_BIN" ]; then
    echo "missing executable DS4_BIN=$DS4_BIN" >&2
    exit 2
fi
if [ ! -x "$DS4_SERVER_BIN" ]; then
    echo "missing executable DS4_SERVER_BIN=$DS4_SERVER_BIN" >&2
    exit 2
fi

"$CC_BIN" -O2 -g -Wall -Wextra -std=c99 -D_GNU_SOURCE -I. $CFLAGS_LOCAL \
    -o "$BIN" \
    tests/tool_compression_token_probe.c ds4_tool_compress.c ds4_context_blob.c
compile_rc=$?
if [ "$compile_rc" -ne 0 ]; then
    echo "compile failed" >&2
    exit "$compile_rc"
fi

python3 - "$WORK" <<'PY'
from __future__ import annotations
import json
import pathlib
import subprocess
import sys

work = pathlib.Path(sys.argv[1])
root = pathlib.Path.cwd()
work.mkdir(parents=True, exist_ok=True)
try:
    files = subprocess.check_output(["git", "ls-files"], cwd=root, text=True).splitlines()
except Exception:
    files = []
items = []
for rel in files:
    p = root / rel
    if not p.is_file():
        continue
    try:
        text = p.read_text(encoding="utf-8", errors="replace") if p.stat().st_size < 2_000_000 else ""
        lines = text.count("\n") + (1 if text else 0)
        size = p.stat().st_size
    except OSError:
        lines = 0
        size = 0
    items.append({"path": rel, "bytes": size, "lines": lines, "suffix": p.suffix})
(work / "repo_file_metadata.json").write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

: > "$RAW"
set +e
"$BIN" "$WORK/context-blobs" repo_file_metadata api_result "$WORK/repo_file_metadata.json" "$WORK/repo_file_metadata.effective.txt" yes 0.80 >> "$RAW"
probe_rc=$?
set -e
if [ "$probe_rc" -ne 0 ]; then
    echo "compression probe failed" >&2
    exit "$probe_rc"
fi

token_count() {
    local file="$1"
    local out="$WORK/tokens.$(basename "$file").txt"
    set +e
    "$DS4_BIN" --backend "$DS4_BACKEND" --dump-tokens --prompt-file "$file" -n 1 --ctx 2048 > "$out" 2> "$out.err"
    local rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
        echo "tokenize failed for $file" >&2
        cat "$out.err" >&2
        echo -1
        return 1
    fi
    python3 - "$out" <<'PY'
from __future__ import annotations
import re
import sys
path = sys.argv[1]
with open(path, 'r', encoding='utf-8', errors='replace') as f:
    first = f.readline().strip()
if first == '[]' or not first:
    print(0)
else:
    print(len(re.findall(r'-?\d+', first)))
PY
}

orig_tokens=$(token_count "$WORK/repo_file_metadata.json")
eff_tokens=$(token_count "$WORK/repo_file_metadata.effective.txt")
python3 - "$orig_tokens" "$eff_tokens" >> "$RAW" <<'PY'
from __future__ import annotations
import sys
orig = int(sys.argv[1])
eff = int(sys.argv[2])
saved = max(0, orig - eff)
ratio = eff / orig if orig else 1.0
saved_pct = 100.0 * saved / orig if orig else 0.0
print(f"tokens\tname=repo_file_metadata\toriginal_tokens={orig}\teffective_tokens={eff}\tsaved_tokens={saved}\ttoken_ratio={ratio:.6f}\ttoken_saved_pct={saved_pct:.2f}")
PY

BASE_URL="$DS4_METADATA_BASE_URL"
SERVER_MODE="external"
if [ -z "$BASE_URL" ]; then
    if python3 - <<'PY' >/dev/null 2>&1
import urllib.request
with urllib.request.urlopen('http://127.0.0.1:8002/v1/models', timeout=2) as r:
    raise SystemExit(0 if 200 <= r.status < 300 else 1)
PY
    then
        BASE_URL="http://127.0.0.1:8002"
        SERVER_MODE="existing-wrapper"
    fi
fi

if [ -z "$BASE_URL" ]; then
    PORT="$(python3 - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
)"
    SERVER_LOG="$WORK/server.log"
    "$DS4_SERVER_BIN" --backend "$DS4_BACKEND" --ctx "$DS4_METADATA_CTX" -n "$DS4_METADATA_MAX_TOKENS" \
        --host 127.0.0.1 --port "$PORT" > "$SERVER_LOG" 2>&1 &
    SERVER_PID=$!
    BASE_URL="http://127.0.0.1:$PORT"
    SERVER_MODE="launched-ds4-server"
    python3 - "$BASE_URL" "$SERVER_PID" "$DS4_SERVER_START_TIMEOUT" <<'PY'
from __future__ import annotations
import os
import sys
import time
import urllib.request
base = sys.argv[1].rstrip('/')
pid = int(sys.argv[2])
timeout = float(sys.argv[3])
start = time.time()
while time.time() - start < timeout:
    try:
        with urllib.request.urlopen(f'{base}/v1/models', timeout=2) as r:
            if 200 <= r.status < 300:
                sys.exit(0)
    except Exception:
        pass
    try:
        os.kill(pid, 0)
    except OSError:
        print('server exited before ready', file=sys.stderr)
        sys.exit(1)
    time.sleep(1)
print('server did not become ready', file=sys.stderr)
sys.exit(1)
PY
    ready_rc=$?
    if [ "$ready_rc" -ne 0 ]; then
        cat "$SERVER_LOG" >&2 || true
        exit "$ready_rc"
    fi
fi

DS4_METADATA_CTX="$(python3 - "$BASE_URL" "$DS4_METADATA_CTX" <<'PY'
from __future__ import annotations
import json
import sys
import urllib.request
base = sys.argv[1].rstrip('/')
fallback = sys.argv[2]
try:
    with urllib.request.urlopen(f'{base}/v1/models', timeout=5) as r:
        obj = json.loads(r.read().decode('utf-8', errors='replace'))
    data = obj.get('data') or []
    first = data[0] if data else {}
    ctx = first.get('context_length') or (first.get('top_provider') or {}).get('context_length')
    print(int(ctx) if ctx else fallback)
except Exception:
    print(fallback)
PY
)"

python3 - "$BASE_URL" "$WORK" "$RAW" "$DS4_METADATA_REPEAT_N" "$DS4_METADATA_REPEAT_SEED" "$DS4_METADATA_REQUEST_TIMEOUT" "$DS4_METADATA_IDLE_WAIT_TIMEOUT" "$DS4_METADATA_MAX_TOKENS" <<'PY'
from __future__ import annotations
import json
import pathlib
import random
import sys
import time
import urllib.error
import urllib.request

base = sys.argv[1].rstrip('/')
work = pathlib.Path(sys.argv[2])
raw_path = pathlib.Path(sys.argv[3])
repeats = int(sys.argv[4])
seed = int(sys.argv[5])
request_timeout = float(sys.argv[6])
idle_timeout = float(sys.argv[7])
max_tokens = int(sys.argv[8])
url = f"{base}/v1/chat/completions"
original = (work / "repo_file_metadata.json").read_text(encoding="utf-8", errors="replace")
effective = (work / "repo_file_metadata.effective.txt").read_text(encoding="utf-8", errors="replace")

rng = random.Random(seed)
jobs = []
for rep in range(1, repeats + 1):
    pair = [(rep, "original"), (rep, "effective")]
    rng.shuffle(pair)
    jobs.extend(pair)

def request_chat(prompt: str, timeout_sec: float):
    body = {
        "model": "deepseek-v4-flash",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0,
        "stream": False,
        "thinking": False,
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.perf_counter()
    status = 0
    payload = ""
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as r:
            status = r.status
            payload = r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = e.code
        payload = e.read().decode("utf-8", errors="replace")
    except Exception as e:
        status = -1
        payload = str(e)
    return status, payload, time.perf_counter() - t0

def wait_idle():
    start = time.time()
    while time.time() - start < idle_timeout:
        status, payload, _ = request_chat("Reply exactly IDLE_OK.", min(30.0, request_timeout))
        if 200 <= status < 300:
            return True, ""
        if status == 409 or "busy" in payload.lower() or "conflict" in payload.lower():
            time.sleep(10)
        else:
            time.sleep(5)
    return False, "idle wait timeout"

def run_one(rep: int, variant: str):
    nonce = f"metadata-repeat-{rep:02d}"
    text = original if variant == "original" else effective
    prompt = (
        f"Run nonce: {nonce}.\n"
        "Operational repeated benchmark for repo_file_metadata.\n"
        "The nonce is before the payload to avoid exact prompt-cache reuse across repetitions.\n"
        "Inspect the following tool output only enough to answer the final instruction.\n"
        "<tool_output>\n"
        + text +
        "\n</tool_output>\n"
        "Final instruction: reply with exactly OPBENCH_OK.\n"
    )
    idle_ok, idle_err = wait_idle()
    if not idle_ok:
        return {"rep": rep, "variant": variant, "status": 409, "ok_http": False, "elapsed": 0.0, "prompt_tokens": -1, "completion_tokens": -1, "contains_ok": False, "finish": "", "error": idle_err}
    status, payload, elapsed = request_chat(prompt, request_timeout)
    if status == 409:
        idle_ok, _ = wait_idle()
        if idle_ok:
            status, payload, elapsed = request_chat(prompt, request_timeout)
    ok_http = 200 <= status < 300
    prompt_tokens = -1
    completion_tokens = -1
    finish = ""
    content = ""
    error = ""
    try:
        obj = json.loads(payload)
        usage = obj.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens", -1) or -1)
        completion_tokens = int(usage.get("completion_tokens", -1) or -1)
        choices = obj.get("choices") or []
        if choices:
            finish = str(choices[0].get("finish_reason", ""))
            content = str((choices[0].get("message") or {}).get("content", ""))
        if not ok_http:
            error = str(obj.get("error") or obj)[:180].replace("\t", " ").replace("\n", " ")
    except Exception:
        error = payload[:180].replace("\t", " ").replace("\n", " ")
    return {"rep": rep, "variant": variant, "status": status, "ok_http": ok_http, "elapsed": elapsed, "prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens, "contains_ok": "OPBENCH_OK" in content, "finish": finish, "error": error}

rows = [run_one(rep, variant) for rep, variant in jobs]
with raw_path.open("a", encoding="utf-8") as f:
    for r in rows:
        f.write(
            "repeat"
            f"\tname=repo_file_metadata"
            f"\trep={r['rep']}"
            f"\tvariant={r['variant']}"
            f"\tstatus={r['status']}"
            f"\tok_http={1 if r['ok_http'] else 0}"
            f"\telapsed_sec={r['elapsed']:.6f}"
            f"\tprompt_tokens={r['prompt_tokens']}"
            f"\tcompletion_tokens={r['completion_tokens']}"
            f"\tfinish={r['finish']}"
            f"\tcontains_ok={1 if r['contains_ok'] else 0}"
            f"\terror={r['error']}"
            "\n"
        )
PY

python3 - "$RAW" "$REPORT" "$DS4_METADATA_REPEAT_N" "$DS4_METADATA_REPEAT_SEED" "$BASE_URL" "$SERVER_MODE" "$DS4_METADATA_CTX" "$DS4_METADATA_MAX_TOKENS" <<'PY'
from __future__ import annotations
import datetime as dt
import math
import pathlib
import platform
import statistics
import subprocess
import sys

raw_path = pathlib.Path(sys.argv[1])
report_path = pathlib.Path(sys.argv[2])
repeats = int(sys.argv[3])
seed = sys.argv[4]
base_url = sys.argv[5]
server_mode = sys.argv[6]
ctx = int(sys.argv[7])
max_tokens = int(sys.argv[8])
rows = []
for raw in raw_path.read_text(encoding="utf-8").splitlines():
    if not raw.strip():
        continue
    parts = raw.split("\t")
    row = {"_tag": parts[0]}
    for part in parts[1:]:
        if "=" in part:
            k, v = part.split("=", 1)
            row[k] = v
    rows.append(row)

def i(row, key, default=0):
    try:
        return int(float(row.get(key, default)))
    except Exception:
        return default

def f(row, key, default=0.0):
    try:
        return float(row.get(key, default))
    except Exception:
        return default

def fmt(x):
    return f"{x:.3f}s"

def stat(values):
    values = list(values)
    if not values:
        return {"n": 0, "mean": 0.0, "median": 0.0, "min": 0.0, "max": 0.0, "stdev": 0.0}
    return {
        "n": len(values),
        "mean": statistics.mean(values),
        "median": statistics.median(values),
        "min": min(values),
        "max": max(values),
        "stdev": statistics.stdev(values) if len(values) > 1 else 0.0,
    }

def pct(part, whole):
    return 100.0 * part / whole if whole else 0.0

case = next((r for r in rows if r.get("_tag") == "case"), {})
tokens = next((r for r in rows if r.get("_tag") == "tokens"), {})
repeat_rows = [r for r in rows if r.get("_tag") == "repeat"]
orig_rows = [r for r in repeat_rows if r.get("variant") == "original" and i(r, "ok_http") == 1]
eff_rows = [r for r in repeat_rows if r.get("variant") == "effective" and i(r, "ok_http") == 1]
orig_lat = [f(r, "elapsed_sec") for r in orig_rows]
eff_lat = [f(r, "elapsed_sec") for r in eff_rows]
orig_stat = stat(orig_lat)
eff_stat = stat(eff_lat)
mean_delta = orig_stat["mean"] - eff_stat["mean"]
median_delta = orig_stat["median"] - eff_stat["median"]
mean_speedup = orig_stat["mean"] / eff_stat["mean"] if eff_stat["mean"] > 0 else math.inf
median_speedup = orig_stat["median"] / eff_stat["median"] if eff_stat["median"] > 0 else math.inf
orig_tokens = i(tokens, "original_tokens")
eff_tokens = i(tokens, "effective_tokens")
saved_tokens = max(0, orig_tokens - eff_tokens)
try:
    git_head = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
except Exception:
    git_head = "unknown"

slower = eff_stat["mean"] > orig_stat["mean"] if orig_stat["n"] and eff_stat["n"] else False
status = "PASS" if len(orig_rows) == repeats and len(eff_rows) == repeats else "REVIEW"

lines = []
lines.append("# DS4 repo_file_metadata repeated operational certification")
lines.append("")
lines.append(f"Status: **{status}**")
lines.append("")
lines.append("## Why this exists")
lines.append("")
lines.append("The long-run operational benchmark showed `repo_file_metadata` as an outlier: the compressed form used fewer tokens but was slower in one run. This report repeats that one case with randomized order and a per-repetition nonce placed before the payload to reduce exact prompt-cache reuse.")
lines.append("")
lines.append("## Environment")
lines.append("")
lines.append(f"- Generated at: `{dt.datetime.now(dt.timezone.utc).isoformat()}`")
lines.append(f"- Git HEAD: `{git_head}`")
lines.append(f"- Platform: `{platform.platform()}`")
lines.append(f"- Server URL: `{base_url}`")
lines.append(f"- Server mode: `{server_mode}`")
lines.append(f"- Context: **{ctx:,}** tokens")
lines.append(f"- Max output tokens: **{max_tokens}**")
lines.append(f"- Repetitions per variant: **{repeats}**")
lines.append(f"- Random seed: **{seed}**")
lines.append(f"- Raw results: `{raw_path.as_posix()}`")
lines.append("")
lines.append("## Token and byte effect")
lines.append("")
lines.append(f"- Original bytes: **{i(case, 'original_bytes'):,}**")
lines.append(f"- Effective bytes: **{i(case, 'effective_bytes'):,}**")
lines.append(f"- Byte saving: **{i(case, 'saved_bytes'):,}** ({f(case, 'byte_saved_pct'):.2f}%)")
lines.append(f"- Original DS4 tokens: **{orig_tokens:,}**")
lines.append(f"- Effective DS4 tokens: **{eff_tokens:,}**")
lines.append(f"- DS4 token saving: **{saved_tokens:,}** ({pct(saved_tokens, orig_tokens):.2f}%)")
lines.append("")
lines.append("## Latency summary")
lines.append("")
lines.append("| Variant | n | mean | median | min | max | stdev | mean prompt tokens |")
lines.append("|---|---:|---:|---:|---:|---:|---:|---:|")
lines.append(f"| original | {orig_stat['n']} | {fmt(orig_stat['mean'])} | {fmt(orig_stat['median'])} | {fmt(orig_stat['min'])} | {fmt(orig_stat['max'])} | {fmt(orig_stat['stdev'])} | {statistics.mean([i(r, 'prompt_tokens') for r in orig_rows]) if orig_rows else 0:.0f} |")
lines.append(f"| effective | {eff_stat['n']} | {fmt(eff_stat['mean'])} | {fmt(eff_stat['median'])} | {fmt(eff_stat['min'])} | {fmt(eff_stat['max'])} | {fmt(eff_stat['stdev'])} | {statistics.mean([i(r, 'prompt_tokens') for r in eff_rows]) if eff_rows else 0:.0f} |")
lines.append("")
lines.append(f"- Mean delta original-effective: **{fmt(mean_delta)}**")
lines.append(f"- Median delta original-effective: **{fmt(median_delta)}**")
lines.append(f"- Mean speedup: **{mean_speedup:.2f}x**")
lines.append(f"- Median speedup: **{median_speedup:.2f}x**")
lines.append("")
lines.append("## Per-run rows")
lines.append("")
lines.append("| rep | variant | status | prompt tokens | latency | result |")
lines.append("|---:|---:|---:|---:|---:|---|")
for r in repeat_rows:
    result = "ok" if i(r, "ok_http") == 1 else (r.get("error") or "fail")
    lines.append(f"| {i(r, 'rep')} | {r.get('variant')} | {i(r, 'status')} | {i(r, 'prompt_tokens'):,} | {fmt(f(r, 'elapsed_sec'))} | {result} |")
lines.append("")
lines.append("## Interpretation")
lines.append("")
if slower:
    lines.append("The repeated run confirms the outlier: despite a deterministic token reduction, the compressed variant is slower on average for this medium JSON metadata corpus in the current server/cache conditions.")
else:
    lines.append("The repeated run does not confirm the one-off outlier: the compressed variant is faster on average/median under nonce-randomized repetitions.")
lines.append("")
lines.append("The deterministic win remains context headroom: the compressed metadata payload uses far fewer DS4 tokens. Latency for this medium case is less reliable because the total prompt is small enough for cache effects, fixed overhead, and scheduling to dominate.")
lines.append("")
lines.append("## Remediation strategy if we want latency wins for medium JSON")
lines.append("")
lines.append("1. Add a stricter JSON compression acceptance gate that estimates not only byte reduction but also final marker overhead; for medium payloads, skip compression unless token ratio is below a configurable threshold, e.g. <= 0.50 and saved_tokens >= 8k.")
lines.append("2. Special-case JSON metadata arrays with a smaller marker/body budget: current generic JSON compressor carries samples plus retrieval metadata; medium arrays may need a more compact schema summary.")
lines.append("3. Track per-kind operational metrics in the agent: if `json_array_compressor` repeatedly retrieves or slows down without preventing compaction, raise its threshold.")
lines.append("4. Preserve the current behaviour for huge search/read/log outputs; the repeated-metadata result should not weaken the strong benefit for large live-zone outputs.")
lines.append("")
report_path.write_text("\n".join(lines), encoding="utf-8")
print(f"wrote {report_path}")
print(f"status {status}: original_mean={orig_stat['mean']:.3f}s effective_mean={eff_stat['mean']:.3f}s")
PY

cat "$RAW"
