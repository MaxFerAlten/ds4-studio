#!/usr/bin/env bash
set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${1:-docs/certifications}"
mkdir -p "$OUT_DIR"
RAW="$OUT_DIR/tool_compression_model_backed.tsv"
REPORT="$OUT_DIR/tool_compression_model_backed.md"
BIN="$(mktemp /tmp/ds4_tool_compression_token_probe.XXXXXX)"
WORK="$(mktemp -d /tmp/ds4_tool_compression_model.XXXXXX)"
trap 'rm -rf "$BIN" "$WORK"' EXIT

DS4_BIN="${DS4_BIN:-./ds4}"
DS4_BACKEND="${DS4_BACKEND:-rocm}"
CC_BIN="${CC:-cc}"
CFLAGS_LOCAL="${CFLAGS:-}"

if [ ! -x "$DS4_BIN" ]; then
    echo "missing executable DS4_BIN=$DS4_BIN" >&2
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
search = "\n".join(lines) + ("\n" if lines else "")
write("repo_search.txt", search)

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
        lines = text.count("\n") + (1 if text else 0)
        size = p.stat().st_size
    except OSError:
        lines = 0
        size = 0
    items.append({"path": rel, "bytes": size, "lines": lines, "suffix": p.suffix})
write("repo_file_metadata.json", json.dumps(items, ensure_ascii=False, indent=2) + "\n")

trace = root / "traces" / "deepresearch-direct.trace"
write("repo_trace_log.txt", trace.read_text(encoding="utf-8", errors="replace") if trace.exists() else "")

retrieve = "".join(f"context_blob_range real replay line {i:04d} from retrieved payload\n" for i in range(1600))
write("retrieve_context_blob_output.txt", retrieve)
PY

: > "$RAW"
fail=0

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

run_case() {
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

    local raw_tokens effective_tokens
    raw_tokens=$(token_count "$input") || fail=1
    effective_tokens=$(token_count "$effective") || fail=1
    local saved_tokens=0 token_pass=0
    if [ "$raw_tokens" -ge 0 ] && [ "$effective_tokens" -ge 0 ]; then
        if [ "$raw_tokens" -gt "$effective_tokens" ]; then
            saved_tokens=$((raw_tokens - effective_tokens))
        fi
        token_pass=1
        if [ "$expect" = "yes" ] && [ "$effective_tokens" -ge "$raw_tokens" ]; then
            token_pass=0
            fail=1
        fi
        if [ "$expect" = "no" ] && [ "$effective_tokens" -ne "$raw_tokens" ]; then
            token_pass=0
            fail=1
        fi
    else
        fail=1
    fi
    python3 - "$name" "$raw_tokens" "$effective_tokens" "$saved_tokens" "$token_pass" >> "$RAW" <<'PY'
from __future__ import annotations
import sys
name, raw_s, eff_s, saved_s, pass_s = sys.argv[1:]
raw = int(raw_s)
eff = int(eff_s)
saved = int(saved_s)
ratio = (eff / raw) if raw > 0 else 1.0
saved_pct = (100.0 * saved / raw) if raw > 0 else 0.0
print(f"tokens\tname={name}\toriginal_tokens={raw}\teffective_tokens={eff}\tsaved_tokens={saved}\ttoken_ratio={ratio:.6f}\ttoken_saved_pct={saved_pct:.2f}\tpass={pass_s}")
PY
}

run_case repo_search search repo_search.txt yes 0.80
run_case repo_derived_diff bash repo_derived_diff.txt yes 0.80
run_case repo_large_read read repo_large_read.txt yes 0.80
run_case repo_file_metadata api_result repo_file_metadata.json yes 0.80
run_case repo_trace_log bash repo_trace_log.txt any 1.00
run_case retrieve_no_recompress retrieve_context_blob retrieve_context_blob_output.txt no 1.00

python3 - "$RAW" "$WORK" <<'PY'
from __future__ import annotations
import pathlib
import sys
raw = pathlib.Path(sys.argv[1])
work = pathlib.Path(sys.argv[2]).as_posix().rstrip('/') + '/'
raw.write_text(raw.read_text(encoding='utf-8').replace(work, ''), encoding='utf-8')
PY

python3 - "$RAW" "$REPORT" "$fail" "$DS4_BIN" "$DS4_BACKEND" <<'PY'
from __future__ import annotations
import datetime as _dt
import math
import pathlib
import platform
import subprocess
import sys

raw_path = pathlib.Path(sys.argv[1])
report_path = pathlib.Path(sys.argv[2])
probe_fail = int(sys.argv[3])
ds4_bin = sys.argv[4]
ds4_backend = sys.argv[5]
case_rows = []
token_rows = {}
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
        case_rows.append(row)
    elif tag == "tokens":
        token_rows[row.get("name", "")] = row

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

def fmt_bytes(n):
    n = int(n)
    v = float(n)
    for unit in ["B", "KiB", "MiB", "GiB"]:
        if v < 1024 or unit == "GiB":
            return f"{v:.1f} {unit}" if unit != "B" else f"{n} B"
        v /= 1024

orig_bytes = sum(i(r, "original_bytes") for r in case_rows)
eff_bytes = sum(i(r, "effective_bytes") for r in case_rows)
saved_bytes = max(0, orig_bytes - eff_bytes)
orig_tokens = sum(i(token_rows.get(r.get("name", ""), {}), "original_tokens") for r in case_rows)
eff_tokens = sum(i(token_rows.get(r.get("name", ""), {}), "effective_tokens") for r in case_rows)
saved_tokens = max(0, orig_tokens - eff_tokens)
byte_ratio = (eff_bytes / orig_bytes) if orig_bytes else 1.0
token_ratio = (eff_tokens / orig_tokens) if orig_tokens else 1.0
byte_saved_pct = (100.0 * saved_bytes / orig_bytes) if orig_bytes else 0.0
token_saved_pct = (100.0 * saved_tokens / orig_tokens) if orig_tokens else 0.0
case_passed = sum(1 for r in case_rows if r.get("pass") == "1")
token_passed = sum(1 for r in case_rows if token_rows.get(r.get("name", ""), {}).get("pass") == "1")
changed = sum(1 for r in case_rows if r.get("changed") == "1")
aggregate_ok = token_ratio <= 0.60
status = "PASS" if probe_fail == 0 and case_passed == len(case_rows) and token_passed == len(case_rows) and aggregate_ok else "FAIL"

try:
    git_head = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
except Exception:
    git_head = "unknown"

lines = []
lines.append("# DS4 tool-output compression model-backed certification")
lines.append("")
lines.append(f"Status: **{status}**")
lines.append("")
lines.append("## Scope")
lines.append("")
lines.append("This certification measures the same real-corpus compressor cases with the actual DS4 tokenizer via `./ds4 --dump-tokens`. It is model-backed at the tokenizer/vocabulary layer: it uses the loaded DS4 GGUF tokenizer to count real prompt tokens for the original tool output and for the exact compressed text that would be appended to the agent transcript.")
lines.append("")
lines.append("It intentionally does **not** run full model generation; latency/decode certification remains a separate, heavier benchmark.")
lines.append("")
lines.append("Aggregate pass threshold: effective tokenizer-backed tokens <= 60% of original tokens.")
lines.append("")
lines.append("## Environment")
lines.append("")
lines.append(f"- Generated at: {_dt.datetime.now(_dt.timezone.utc).isoformat()}")
lines.append(f"- Git HEAD: `{git_head}`")
lines.append(f"- Platform: `{platform.platform()}`")
lines.append(f"- DS4 binary: `{ds4_bin}`")
lines.append(f"- DS4 backend for tokenizer command: `{ds4_backend}`")
lines.append(f"- Raw results: `{raw_path.as_posix()}`")
lines.append(f"- Command: `scripts/certify_tool_compression_model_backed.sh`")
lines.append("")
lines.append("## Aggregate result")
lines.append("")
lines.append(f"- Cases: **{len(case_rows)}**, per-case passed **{case_passed}**, token checks passed **{token_passed}**, compressed **{changed}**")
lines.append(f"- Original bytes: **{orig_bytes:,}** ({fmt_bytes(orig_bytes)})")
lines.append(f"- Effective bytes: **{eff_bytes:,}** ({fmt_bytes(eff_bytes)})")
lines.append(f"- Byte saving: **{saved_bytes:,}** ({byte_saved_pct:.2f}%)")
lines.append(f"- Original DS4 tokens: **{orig_tokens:,}**")
lines.append(f"- Effective DS4 tokens: **{eff_tokens:,}**")
lines.append(f"- DS4 token saving: **{saved_tokens:,}** ({token_saved_pct:.2f}%)")
lines.append(f"- Token ratio: **{token_ratio:.4f}x**")
lines.append(f"- Byte ratio: **{byte_ratio:.4f}x**")
lines.append("")
lines.append("## Per-case result")
lines.append("")
lines.append("| Case | Tool | Strategy | Changed | Original tokens | Effective tokens | Saved tokens | Token ratio | Original bytes | Effective bytes | Blob exact | Pass |")
lines.append("|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
for r in case_rows:
    name = r.get("name", "")
    t = token_rows.get(name, {})
    lines.append(
        "| {name} | `{tool}` | `{strategy}` | {changed} | {otoks} | {etoks} | {stoks} ({spct:.2f}%) | {tratio:.4f}x | {obytes} | {ebytes} | {retrievable} | {passed} |".format(
            name=name,
            tool=r.get("tool", ""),
            strategy=r.get("strategy", ""),
            changed="yes" if r.get("changed") == "1" else "no",
            otoks=f"{i(t, 'original_tokens'):,}",
            etoks=f"{i(t, 'effective_tokens'):,}",
            stoks=f"{i(t, 'saved_tokens'):,}",
            spct=f(t, "token_saved_pct"),
            tratio=f(t, "token_ratio", 1.0),
            obytes=f"{i(r, 'original_bytes'):,}",
            ebytes=f"{i(r, 'effective_bytes'):,}",
            retrievable="yes" if r.get("retrievable") == "1" else ("n/a" if r.get("changed") == "0" else "no"),
            passed="yes" if r.get("pass") == "1" and t.get("pass") == "1" else "no",
        )
    )
lines.append("")
lines.append("## Certification decision")
lines.append("")
if status == "PASS":
    lines.append("The compressor passes the model/tokenizer-backed certification: exact DS4 token counts confirm substantial token reduction, all reversible-blob invariants passed, and aggregate token ratio stayed below the 0.60 threshold.")
else:
    lines.append("The compressor does **not** pass the model/tokenizer-backed certification. Inspect raw TSV rows for failing byte or token checks.")
lines.append("")
lines.append("## Remaining gap")
lines.append("")
lines.append("This certification proves exact tokenizer savings, but not end-to-end answer quality or latency. A final operational benchmark should run full agent turns and compare hard-compaction count, prefill time, decode time, and retrieval frequency.")
lines.append("")
report_path.write_text("\n".join(lines), encoding="utf-8")
print(f"wrote {report_path}")
print(f"status {status}: saved {saved_tokens:,}/{orig_tokens:,} DS4 tokens ({token_saved_pct:.2f}%)")
PY
report_rc=$?
if [ "$report_rc" -ne 0 ]; then
    exit "$report_rc"
fi

cat "$RAW"
exit "$fail"
