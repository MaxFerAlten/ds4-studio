#!/usr/bin/env bash
set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${1:-docs/certifications}"
mkdir -p "$OUT_DIR"
STEM="${DS4_OPERATIONAL_REPORT_STEM:-tool_compression_operational}"
RAW="$OUT_DIR/${STEM}.tsv"
REPORT="$OUT_DIR/${STEM}.md"
BIN="$(mktemp /tmp/ds4_tool_compression_token_probe.XXXXXX)"
WORK="$(mktemp -d /tmp/ds4_tool_compression_operational.XXXXXX)"
SERVER_PID=""
trap 'if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi; rm -rf "$BIN" "$WORK"' EXIT

DS4_BIN="${DS4_BIN:-./ds4}"
DS4_SERVER_BIN="${DS4_SERVER_BIN:-./ds4-server}"
DS4_BACKEND="${DS4_BACKEND:-rocm}"
DS4_OPERATIONAL_CTX="${DS4_OPERATIONAL_CTX:-32768}"
DS4_OPERATIONAL_MAX_TOKENS="${DS4_OPERATIONAL_MAX_TOKENS:-8}"
DS4_SERVER_START_TIMEOUT="${DS4_SERVER_START_TIMEOUT:-300}"
DS4_OPERATIONAL_BASE_URL="${DS4_OPERATIONAL_BASE_URL:-}"
DS4_OPERATIONAL_ORIGINAL_RUN_TOKEN_LIMIT="${DS4_OPERATIONAL_ORIGINAL_RUN_TOKEN_LIMIT:-20000}"
DS4_OPERATIONAL_REQUEST_TIMEOUT="${DS4_OPERATIONAL_REQUEST_TIMEOUT:-900}"
DS4_OPERATIONAL_LONG_REQUEST_TIMEOUT="${DS4_OPERATIONAL_LONG_REQUEST_TIMEOUT:-7200}"
DS4_OPERATIONAL_RUN_HUGE_ORIGINALS="${DS4_OPERATIONAL_RUN_HUGE_ORIGINALS:-0}"
DS4_OPERATIONAL_IDLE_WAIT_TIMEOUT="${DS4_OPERATIONAL_IDLE_WAIT_TIMEOUT:-900}"
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
import difflib
import json
import pathlib
import subprocess
import sys

work = pathlib.Path(sys.argv[1])
work.mkdir(parents=True, exist_ok=True)
root = pathlib.Path.cwd()

def write(name: str, text: str):
    (work / name).write_text(text, encoding="utf-8", errors="replace")

# Deterministic grep-like corpus from C/H files.
lines = []
for path in sorted(root.rglob("*")):
    rel = path.relative_to(root)
    rel_s = rel.as_posix()
    if ".git/" in rel_s or rel_s.startswith(".git/"):
        continue
    if "frontend/node_modules/" in rel_s or rel_s.startswith("frontend/node_modules/"):
        continue
    if path.suffix not in {".c", ".h"} or not path.is_file():
        continue
    try:
        for no, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if "ds4_" in line:
                lines.append(f"{rel_s}:{no}:{line}")
    except OSError:
        pass
write("repo_search.txt", "\n".join(lines) + ("\n" if lines else ""))

src_path = root / "ds4_tool_compress.c"
src = src_path.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
mut = []
for line in src:
    changed = line.replace("compressed", "certified_compressed")
    changed = changed.replace("omitted_lines", "cert_omitted_lines")
    mut.append(changed)
diff = "".join(difflib.unified_diff(src, mut, fromfile="a/ds4_tool_compress.c", tofile="b/ds4_tool_compress.c", n=12))
write("repo_derived_diff.txt", diff)

agent_src = (root / "ds4_agent.c").read_text(encoding="utf-8", errors="replace")
read_body = "Tool result 1 (read):\npath: ds4_agent.c\n<file>\n" + agent_src + "\n</file>\n"
write("repo_large_read.txt", read_body)

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
        lines_n = text.count("\n") + (1 if text else 0)
        size = p.stat().st_size
    except OSError:
        lines_n = 0
        size = 0
    items.append({"path": rel, "bytes": size, "lines": lines_n, "suffix": p.suffix})
write("repo_file_metadata.json", json.dumps(items, ensure_ascii=False, indent=2) + "\n")
PY

: > "$RAW"
fail=0

run_probe() {
    local name="$1" tool="$2" input_name="$3" expect="$4" max_ratio="$5"
    local input="$WORK/$input_name"
    local effective="$WORK/${name}.effective.txt"
    set +e
    "$BIN" "$WORK/context-blobs" "$name" "$tool" "$input" "$effective" "$expect" "$max_ratio" >> "$RAW"
    local rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
        fail=1
    fi
}

run_probe repo_search search repo_search.txt yes 0.80
run_probe repo_derived_diff bash repo_derived_diff.txt yes 0.80
run_probe repo_large_read read repo_large_read.txt yes 0.80
run_probe repo_file_metadata api_result repo_file_metadata.json yes 0.80

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

for name in repo_search repo_derived_diff repo_large_read repo_file_metadata; do
    case "$name" in
        repo_search) input="$WORK/repo_search.txt" ;;
        repo_derived_diff) input="$WORK/repo_derived_diff.txt" ;;
        repo_large_read) input="$WORK/repo_large_read.txt" ;;
        repo_file_metadata) input="$WORK/repo_file_metadata.json" ;;
    esac
    effective="$WORK/${name}.effective.txt"
    raw_tokens=$(token_count "$input") || fail=1
    effective_tokens=$(token_count "$effective") || fail=1
    python3 - "$name" "$raw_tokens" "$effective_tokens" >> "$RAW" <<'PY'
from __future__ import annotations
import sys
name = sys.argv[1]
raw = int(sys.argv[2])
eff = int(sys.argv[3])
saved = max(0, raw - eff)
ratio = (eff / raw) if raw > 0 else 1.0
saved_pct = (100.0 * saved / raw) if raw > 0 else 0.0
print(f"tokens\tname={name}\toriginal_tokens={raw}\teffective_tokens={eff}\tsaved_tokens={saved}\ttoken_ratio={ratio:.6f}\ttoken_saved_pct={saved_pct:.2f}")
PY
done

BASE_URL="$DS4_OPERATIONAL_BASE_URL"
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
    TRACE="$WORK/server.trace"
    SERVER_LOG="$WORK/server.log"
    "$DS4_SERVER_BIN" --backend "$DS4_BACKEND" --ctx "$DS4_OPERATIONAL_CTX" -n "$DS4_OPERATIONAL_MAX_TOKENS" \
        --host 127.0.0.1 --port "$PORT" --trace "$TRACE" > "$SERVER_LOG" 2>&1 &
    SERVER_PID=$!
    BASE_URL="http://127.0.0.1:$PORT"
    SERVER_MODE="launched-ds4-server"

    python3 - "$BASE_URL" "$SERVER_PID" "$DS4_SERVER_START_TIMEOUT" <<'PY'
from __future__ import annotations
import os
import sys
import time
import urllib.request
base_url = sys.argv[1].rstrip('/')
pid = int(sys.argv[2])
timeout = float(sys.argv[3])
url = f"{base_url}/v1/models"
start = time.time()
while time.time() - start < timeout:
    try:
        with urllib.request.urlopen(url, timeout=2) as r:
            if 200 <= r.status < 300:
                sys.exit(0)
    except Exception:
        pass
    try:
        os.kill(pid, 0)
    except OSError:
        print("server exited before becoming ready", file=sys.stderr)
        sys.exit(1)
    time.sleep(1)
print("server did not become ready before timeout", file=sys.stderr)
sys.exit(1)
PY
    ready_rc=$?
    if [ "$ready_rc" -ne 0 ]; then
        cat "$SERVER_LOG" >&2 || true
        exit "$ready_rc"
    fi
fi

DS4_OPERATIONAL_CTX="$(python3 - "$BASE_URL" "$DS4_OPERATIONAL_CTX" <<'PY'
from __future__ import annotations
import json
import sys
import urllib.request
base_url = sys.argv[1].rstrip('/')
fallback = sys.argv[2]
try:
    with urllib.request.urlopen(f'{base_url}/v1/models', timeout=5) as r:
        obj = json.loads(r.read().decode('utf-8', errors='replace'))
    data = obj.get('data') or []
    first = data[0] if data else {}
    ctx = first.get('context_length') or (first.get('top_provider') or {}).get('context_length')
    print(int(ctx) if ctx else fallback)
except Exception:
    print(fallback)
PY
)"

python3 - "$BASE_URL" "$WORK" "$RAW" "$DS4_OPERATIONAL_CTX" "$DS4_OPERATIONAL_MAX_TOKENS" "$DS4_OPERATIONAL_ORIGINAL_RUN_TOKEN_LIMIT" "$DS4_OPERATIONAL_REQUEST_TIMEOUT" "$DS4_OPERATIONAL_LONG_REQUEST_TIMEOUT" "$DS4_OPERATIONAL_RUN_HUGE_ORIGINALS" "$DS4_OPERATIONAL_IDLE_WAIT_TIMEOUT" <<'PY'
from __future__ import annotations
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

base_url = sys.argv[1].rstrip('/')
work = pathlib.Path(sys.argv[2])
raw_path = pathlib.Path(sys.argv[3])
ctx = int(sys.argv[4])
max_tokens = int(sys.argv[5])
original_run_token_limit = int(sys.argv[6])
request_timeout = float(sys.argv[7])
long_request_timeout = float(sys.argv[8])
run_huge_originals = sys.argv[9] in {"1", "true", "yes"}
idle_wait_timeout = float(sys.argv[10])
url = f"{base_url}/v1/chat/completions"

cases = [
    ("repo_search", "repo_search.txt", "repo_search.effective.txt"),
    ("repo_derived_diff", "repo_derived_diff.txt", "repo_derived_diff.effective.txt"),
    ("repo_large_read", "repo_large_read.txt", "repo_large_read.effective.txt"),
    ("repo_file_metadata", "repo_file_metadata.json", "repo_file_metadata.effective.txt"),
]

def read_token_rows():
    rows = {}
    for raw in raw_path.read_text(encoding="utf-8").splitlines():
        if not raw.startswith("tokens\t"):
            continue
        row = {}
        for part in raw.split("\t")[1:]:
            if "=" in part:
                k, v = part.split("=", 1)
                row[k] = v
        rows[row.get("name", "")] = row
    return rows

token_rows = read_token_rows()

def int_row(row, key, default=0):
    try:
        return int(row.get(key, default))
    except Exception:
        return default

def request_chat(prompt: str, timeout_sec: float):
    body = {
        "model": "deepseek-v4-flash",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0,
        "stream": False,
        "thinking": False,
    }
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    t0 = time.perf_counter()
    status = 0
    payload_text = ""
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as r:
            status = r.status
            payload_text = r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = e.code
        payload_text = e.read().decode("utf-8", errors="replace")
    except Exception as e:
        status = -1
        payload_text = str(e)
    elapsed = time.perf_counter() - t0
    return status, payload_text, elapsed

def wait_idle():
    probe = "Reply with exactly IDLE_OK."
    start = time.time()
    last = ""
    while time.time() - start < idle_wait_timeout:
        status, payload, _elapsed = request_chat(probe, min(30.0, request_timeout))
        if 200 <= status < 300:
            return True, ""
        last = payload[:180].replace("\t", " ").replace("\n", " ")
        if status == 409 or "busy" in payload.lower() or "conflict" in payload.lower():
            time.sleep(10)
            continue
        time.sleep(5)
    return False, last or "idle wait timeout"

def send(case: str, variant: str, text: str, timeout_sec: float):
    prompt = (
        "Operational DS4 tool-compression benchmark.\n"
        "Inspect the following tool output only enough to answer the final instruction.\n"
        "<tool_output>\n"
        + text +
        "\n</tool_output>\n"
        "Final instruction: reply with exactly OPBENCH_OK.\n"
    )
    idle_ok, idle_err = wait_idle()
    if not idle_ok:
        return {
            "case": case, "variant": variant, "status": 409, "ok_http": False,
            "elapsed_sec": 0.0, "prompt_tokens": -1, "completion_tokens": -1,
            "finish": "", "contains_ok": False, "error": f"server not idle: {idle_err}",
            "skipped": False, "projected": False, "timeout_sec": timeout_sec,
        }
    status, payload_text, elapsed = request_chat(prompt, timeout_sec)
    # If an external request raced us, wait once and retry.
    if status == 409:
        idle_ok, _idle_err = wait_idle()
        if idle_ok:
            status, payload_text, elapsed = request_chat(prompt, timeout_sec)
    ok_http = 200 <= status < 300
    prompt_tokens = -1
    completion_tokens = -1
    content = ""
    finish = ""
    error = ""
    try:
        obj = json.loads(payload_text)
        usage = obj.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens", -1) or -1)
        completion_tokens = int(usage.get("completion_tokens", -1) or -1)
        choices = obj.get("choices") or []
        if choices:
            finish = str(choices[0].get("finish_reason", ""))
            msg = choices[0].get("message") or {}
            content = str(msg.get("content", ""))
        if not ok_http:
            error = str(obj.get("error") or obj)[:180].replace("\t", " ").replace("\n", " ")
    except Exception:
        error = payload_text[:180].replace("\t", " ").replace("\n", " ")
    return {
        "case": case, "variant": variant, "status": status, "ok_http": ok_http,
        "elapsed_sec": elapsed, "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens, "finish": finish,
        "contains_ok": "OPBENCH_OK" in content, "error": error,
        "skipped": False, "projected": False, "timeout_sec": timeout_sec,
    }

def skipped_row(case: str, variant: str, reason: str):
    return {
        "case": case, "variant": variant, "status": 0, "ok_http": False,
        "elapsed_sec": 0.0, "prompt_tokens": -1, "completion_tokens": -1,
        "finish": "", "contains_ok": False, "error": reason,
        "skipped": True, "projected": True, "timeout_sec": 0,
    }

jobs = []
# Run all compressed/effective payloads first; these are the feature contract.
for case, _original_name, effective_name in cases:
    jobs.append((case, "effective", effective_name, request_timeout))
# Run small originals for measured paired latency.
huge_originals = []
for case, original_name, _effective_name in cases:
    orig_tokens = int_row(token_rows.get(case, {}), "original_tokens")
    if orig_tokens <= original_run_token_limit:
        jobs.append((case, "original", original_name, request_timeout))
    elif run_huge_originals:
        huge_originals.append((case, "original", original_name, long_request_timeout))
    else:
        jobs.append((case, "original-skip", original_name, 0))
# True long-running originals are last so they cannot poison the short part.
jobs.extend(huge_originals)

rows = []
for case, variant, filename, timeout_sec in jobs:
    if variant == "original-skip":
        rows.append(skipped_row(case, "original", f"skipped_large_original_by_policy token_limit={original_run_token_limit}"))
        continue
    text = (work / filename).read_text(encoding="utf-8", errors="replace")
    rows.append(send(case, variant, text, timeout_sec))

with raw_path.open("a", encoding="utf-8") as f:
    for r in rows:
        f.write(
            "operational"
            f"\tname={r['case']}"
            f"\tvariant={r['variant']}"
            f"\tstatus={r['status']}"
            f"\tok_http={1 if r['ok_http'] else 0}"
            f"\tskipped={1 if r['skipped'] else 0}"
            f"\tprojected={1 if r['projected'] else 0}"
            f"\ttimeout_sec={r['timeout_sec']}"
            f"\telapsed_sec={r['elapsed_sec']:.6f}"
            f"\tprompt_tokens={r['prompt_tokens']}"
            f"\tcompletion_tokens={r['completion_tokens']}"
            f"\tfinish={r['finish']}"
            f"\tcontains_ok={1 if r['contains_ok'] else 0}"
            f"\terror={r['error']}"
            "\n"
        )
PY

python3 - "$RAW" "$WORK" <<'PY'
from __future__ import annotations
import pathlib
import sys
raw = pathlib.Path(sys.argv[1])
work = pathlib.Path(sys.argv[2]).as_posix().rstrip('/') + '/'
raw.write_text(raw.read_text(encoding='utf-8').replace(work, ''), encoding='utf-8')
PY

python3 - "$RAW" "$REPORT" "$fail" "$DS4_SERVER_BIN" "$DS4_BIN" "$DS4_BACKEND" "$DS4_OPERATIONAL_CTX" "$DS4_OPERATIONAL_MAX_TOKENS" "$BASE_URL" "$SERVER_MODE" "$DS4_OPERATIONAL_ORIGINAL_RUN_TOKEN_LIMIT" "$DS4_OPERATIONAL_RUN_HUGE_ORIGINALS" <<'PY'
from __future__ import annotations
import datetime as _dt
import pathlib
import platform
import statistics
import subprocess
import sys

raw_path = pathlib.Path(sys.argv[1])
report_path = pathlib.Path(sys.argv[2])
prior_fail = int(sys.argv[3])
ds4_server_bin = sys.argv[4]
ds4_bin = sys.argv[5]
ds4_backend = sys.argv[6]
ctx = int(sys.argv[7])
max_tokens = int(sys.argv[8])
base_url = sys.argv[9]
server_mode = sys.argv[10]
original_run_token_limit = int(sys.argv[11])
run_huge_originals = sys.argv[12] in {"1", "true", "yes"}

case_rows = {}
token_rows = {}
op_rows = []
for raw in raw_path.read_text(encoding="utf-8").splitlines():
    if not raw.strip():
        continue
    parts = raw.split("\t")
    tag = parts[0]
    row = {}
    for part in parts[1:]:
        if "=" in part:
            k, v = part.split("=", 1)
            row[k] = v
    if tag == "case":
        case_rows[row.get("name", "")] = row
    elif tag == "tokens":
        token_rows[row.get("name", "")] = row
    elif tag == "operational":
        op_rows.append(row)

def i(row, key, default=0):
    try:
        return int(row.get(key, default))
    except Exception:
        return default

def f(row, key, default=0.0):
    try:
        return float(row.get(key, default))
    except Exception:
        return default

def fmt_sec(x):
    return f"{x:.3f}s"

by_case = {}
for r in op_rows:
    by_case.setdefault(r.get("name", ""), {})[r.get("variant", "")] = r

successful_rows = [r for r in op_rows if i(r, "ok_http") == 1 and i(r, "prompt_tokens") > 0 and f(r, "elapsed_sec") > 0]
sec_per_token_values = [f(r, "elapsed_sec") / i(r, "prompt_tokens") for r in successful_rows]
sec_per_token = statistics.median(sec_per_token_values) if sec_per_token_values else 0.0
overhead_values = []
for r in successful_rows:
    name = r.get("name", "")
    variant = r.get("variant", "")
    t = token_rows.get(name, {})
    payload = i(t, "original_tokens" if variant == "original" else "effective_tokens")
    if payload >= 0:
        overhead_values.append(i(r, "prompt_tokens") - payload)
prompt_overhead = int(statistics.median(overhead_values)) if overhead_values else 0

compressed_ok = 0
fit_original_ok = 0
expected_rejects = 0
projected_skips = 0
paired_latency = []
projection_lines = []
operational_pass = True
for name, variants in by_case.items():
    t = token_rows.get(name, {})
    orig_tokens = i(t, "original_tokens")
    eff_tokens = i(t, "effective_tokens")
    orig_expected_fit = orig_tokens + max_tokens + 64 < ctx
    eff_expected_fit = eff_tokens + max_tokens + 64 < ctx
    orig = variants.get("original", {})
    eff = variants.get("effective", {})
    orig_ok = i(orig, "ok_http") == 1
    eff_ok = i(eff, "ok_http") == 1
    orig_skipped = i(orig, "skipped") == 1
    if eff_expected_fit and eff_ok:
        compressed_ok += 1
    else:
        operational_pass = False
    if orig_expected_fit:
        if orig_ok:
            fit_original_ok += 1
        elif orig_skipped:
            projected_skips += 1
        else:
            operational_pass = False
    else:
        if not orig_ok:
            expected_rejects += 1
    if orig_ok and eff_ok:
        paired_latency.append((name, f(orig, "elapsed_sec"), f(eff, "elapsed_sec")))
    if orig_skipped and sec_per_token > 0:
        projected_prompt = max(0, orig_tokens + prompt_overhead)
        projected_original_sec = projected_prompt * sec_per_token
        effective_sec = f(eff, "elapsed_sec") if eff_ok else max(0, eff_tokens + prompt_overhead) * sec_per_token
        projection_lines.append((name, projected_original_sec, effective_sec, projected_original_sec - effective_sec))

try:
    git_head = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
except Exception:
    git_head = "unknown"
status = "PASS" if prior_fail == 0 and operational_pass else "FAIL"

orig_tokens_total = sum(i(r, "original_tokens") for r in token_rows.values())
eff_tokens_total = sum(i(r, "effective_tokens") for r in token_rows.values())
saved_tokens_total = max(0, orig_tokens_total - eff_tokens_total)
token_saved_pct = 100.0 * saved_tokens_total / orig_tokens_total if orig_tokens_total else 0.0

latency_lines = []
for name, orig_s, eff_s in paired_latency:
    delta = orig_s - eff_s
    speed = orig_s / eff_s if eff_s > 0 else 0.0
    latency_lines.append((name, orig_s, eff_s, delta, speed))

lines = []
lines.append("# DS4 tool-output compression operational certification")
lines.append("")
lines.append(f"Status: **{status}**")
lines.append("")
lines.append("## Scope")
lines.append("")
lines.append("This certification sends real OpenAI-compatible chat requests to a loaded DS4 server/wrapper and compares original tool-output payloads with the exact compressed payloads produced by the compressor. Huge originals can either be run as a true long-running benchmark or skipped and projected from measured token throughput.")
lines.append("")
lines.append("Pass criteria:")
lines.append("")
lines.append("- every compressed/effective payload expected to fit must receive HTTP 2xx;")
lines.append("- every original payload below `original_run_token_limit` must receive HTTP 2xx;")
lines.append("- originals above `original_run_token_limit` may be skipped in projected mode, or run last when `DS4_OPERATIONAL_RUN_HUGE_ORIGINALS=1`;")
lines.append("- reversible blob invariants from the compressor probe must pass.")
lines.append("")
lines.append("## Environment")
lines.append("")
lines.append(f"- Generated at: {_dt.datetime.now(_dt.timezone.utc).isoformat()}")
lines.append(f"- Git HEAD: `{git_head}`")
lines.append(f"- Platform: `{platform.platform()}`")
lines.append(f"- DS4 server binary: `{ds4_server_bin}`")
lines.append(f"- DS4 server URL: `{base_url}`")
lines.append(f"- DS4 server mode: `{server_mode}`")
lines.append(f"- DS4 tokenizer binary: `{ds4_bin}`")
lines.append(f"- Backend: `{ds4_backend}`")
lines.append(f"- Context: **{ctx:,}** tokens")
lines.append(f"- Max output tokens per request: **{max_tokens}**")
lines.append(f"- Original run token limit: **{original_run_token_limit:,}**")
lines.append(f"- Run huge originals: **{'yes' if run_huge_originals else 'no'}**")
lines.append(f"- Calibration throughput: **{sec_per_token:.6f} sec/token** median over {len(sec_per_token_values)} successful request(s)")
lines.append(f"- Estimated prompt wrapper overhead: **{prompt_overhead:,}** tokens")
lines.append(f"- Raw results: `{raw_path.as_posix()}`")
lines.append(f"- Command: `scripts/certify_tool_compression_operational.sh`")
lines.append("")
lines.append("## Aggregate result")
lines.append("")
lines.append(f"- Cases: **{len(by_case)}**")
lines.append(f"- Compressed/effective requests succeeded: **{compressed_ok}/{len(by_case)}**")
lines.append(f"- Measured original requests succeeded: **{fit_original_ok}**")
lines.append(f"- Large originals skipped/projected: **{projected_skips}**")
lines.append(f"- Oversized original context rejections avoided: **{expected_rejects}**")
lines.append(f"- Original DS4 payload tokens: **{orig_tokens_total:,}**")
lines.append(f"- Effective DS4 payload tokens: **{eff_tokens_total:,}**")
lines.append(f"- Token saving before request wrapper overhead: **{saved_tokens_total:,}** ({token_saved_pct:.2f}%)")
lines.append("")
lines.append("## Operational requests")
lines.append("")
lines.append("| Case | Variant | Payload tokens | Expected fit | HTTP | Skipped | Prompt tokens | Latency | Completion tokens | Result |")
lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---|")
for name in sorted(by_case):
    t = token_rows.get(name, {})
    for variant in ["effective", "original"]:
        r = by_case[name].get(variant, {})
        toks = i(t, "original_tokens" if variant == "original" else "effective_tokens")
        expected_fit = toks + max_tokens + 64 < ctx
        ok_http = i(r, "ok_http") == 1
        skipped = i(r, "skipped") == 1
        status_code = i(r, "status", -1)
        if ok_http:
            result = "ok"
        elif skipped:
            result = "projected skip"
        elif not expected_fit:
            result = "expected context reject"
        else:
            result = "unexpected failure"
        lines.append(
            f"| {name} | {variant} | {toks:,} | {'yes' if expected_fit else 'no'} | {status_code} | {'yes' if skipped else 'no'} | {i(r, 'prompt_tokens', -1):,} | {fmt_sec(f(r, 'elapsed_sec'))} | {i(r, 'completion_tokens', -1):,} | {result} |"
        )
lines.append("")
lines.append("## Paired measured latency where both variants ran")
lines.append("")
if latency_lines:
    lines.append("| Case | Original latency | Effective latency | Delta | Speedup |")
    lines.append("|---|---:|---:|---:|---:|")
    for name, orig_s, eff_s, delta, speed in latency_lines:
        lines.append(f"| {name} | {fmt_sec(orig_s)} | {fmt_sec(eff_s)} | {fmt_sec(delta)} | {speed:.2f}x |")
else:
    lines.append("No pair had both original and effective variants run successfully.")
lines.append("")
lines.append("## Projected latency for skipped huge originals")
lines.append("")
if projection_lines:
    lines.append("| Case | Projected original latency | Measured/projected effective latency | Projected saved time |")
    lines.append("|---|---:|---:|---:|")
    for name, orig_s, eff_s, delta in projection_lines:
        lines.append(f"| {name} | {fmt_sec(orig_s)} | {fmt_sec(eff_s)} | {fmt_sec(delta)} |")
else:
    lines.append("No originals were skipped, or no successful request existed for throughput calibration.")
lines.append("")
lines.append("## Certification decision")
lines.append("")
if status == "PASS":
    lines.append("The compressor passes operational certification in this mode: compressed payloads complete under a real DS4 server/wrapper, measured originals below the run limit complete, and large originals are either run last or safely projected without blocking the shared wrapper.")
else:
    lines.append("The compressor does **not** pass operational certification in this mode. Inspect raw TSV rows for unexpected request failures.")
lines.append("")
lines.append("## Long-running full mode")
lines.append("")
lines.append("To run the true huge-original benchmark, use:")
lines.append("")
lines.append("```sh")
lines.append("DS4_OPERATIONAL_RUN_HUGE_ORIGINALS=1 DS4_OPERATIONAL_LONG_REQUEST_TIMEOUT=7200 scripts/certify_tool_compression_operational.sh")
lines.append("```")
lines.append("")
lines.append("Huge originals are scheduled last so a timeout cannot poison the compressed/small-original certification portion.")
lines.append("")
report_path.write_text("\n".join(lines), encoding="utf-8")
print(f"wrote {report_path}")
print(f"status {status}: compressed_ok={compressed_ok}/{len(by_case)} projected_skips={projected_skips}")
PY
report_rc=$?
if [ "$report_rc" -ne 0 ]; then
    exit "$report_rc"
fi

cat "$RAW"
exit "$fail"
