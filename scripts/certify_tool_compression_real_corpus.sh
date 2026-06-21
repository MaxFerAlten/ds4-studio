#!/usr/bin/env bash
set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${1:-docs/certifications}"
mkdir -p "$OUT_DIR"
RAW="$OUT_DIR/tool_compression_real_corpus.tsv"
REPORT="$OUT_DIR/tool_compression_real_corpus.md"
BIN="$(mktemp /tmp/ds4_tool_compression_probe.XXXXXX)"
WORK="$(mktemp -d /tmp/ds4_tool_compression_real.XXXXXX)"
trap 'rm -rf "$BIN" "$WORK"' EXIT

CC_BIN="${CC:-cc}"
CFLAGS_LOCAL="${CFLAGS:-}"
"$CC_BIN" -O2 -g -Wall -Wextra -std=c99 -D_GNU_SOURCE -I. $CFLAGS_LOCAL \
    -o "$BIN" \
    tests/tool_compression_probe.c ds4_tool_compress.c ds4_context_blob.c
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

# Real grep-like corpus from C/H files.  Use a deterministic in-Python scan
# instead of parallel grep so certification output is reproducible.
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

# Real unified-diff-shaped corpus derived from actual source with deterministic edits.
src_path = root / "ds4_tool_compress.c"
src = src_path.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
mut = []
for line in src:
    changed = line.replace("compressed", "certified_compressed")
    changed = changed.replace("omitted_lines", "cert_omitted_lines")
    mut.append(changed)
diff = "".join(difflib.unified_diff(src, mut, fromfile="a/ds4_tool_compress.c", tofile="b/ds4_tool_compress.c", n=12))
write("repo_derived_diff.txt", diff)

# Real large read corpus from a repository source file as an agent read-like result.
agent_src = (root / "ds4_agent.c").read_text(encoding="utf-8", errors="replace")
read_body = "Tool result 1 (read):\npath: ds4_agent.c\n<file>\n" + agent_src + "\n</file>\n"
write("repo_large_read.txt", read_body)

# Real JSON array corpus from git-tracked file metadata.
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

# Real trace/log corpus if present.  It may or may not compress; the probe accepts either.
trace = root / "traces" / "deepresearch-direct.trace"
if trace.exists():
    write("repo_trace_log.txt", trace.read_text(encoding="utf-8", errors="replace"))
else:
    write("repo_trace_log.txt", "")

# Large retrieve output must remain uncompressed to prevent recursive compression.
retrieve = "".join(f"context_blob_range real replay line {i:04d} from retrieved payload\n" for i in range(1600))
write("retrieve_context_blob_output.txt", retrieve)
PY

: > "$RAW"
fail=0
run_probe() {
    local name="$1" tool="$2" file="$3" expect="$4" max_ratio="$5"
    set +e
    "$BIN" "$WORK/context-blobs" "$name" "$tool" "$WORK/$file" "$expect" "$max_ratio" >> "$RAW"
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
run_probe repo_trace_log bash repo_trace_log.txt any 1.00
run_probe retrieve_no_recompress retrieve_context_blob retrieve_context_blob_output.txt no 1.00

python3 - "$RAW" "$WORK" <<'PY'
from __future__ import annotations
import pathlib
import sys
raw = pathlib.Path(sys.argv[1])
work = pathlib.Path(sys.argv[2]).as_posix().rstrip('/') + '/'
raw.write_text(raw.read_text(encoding='utf-8').replace(work, ''), encoding='utf-8')
PY

python3 - "$RAW" "$REPORT" "$fail" <<'PY'
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
rows = []
for raw in raw_path.read_text(encoding="utf-8").splitlines():
    if not raw.strip():
        continue
    parts = raw.split("\t")
    row = {}
    for part in parts[1:]:
        if "=" in part:
            k, v = part.split("=", 1)
            row[k] = v
    rows.append(row)

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

def approx_tokens(n):
    return math.ceil(int(n) / 4)

orig = sum(i(r, "original_bytes") for r in rows)
eff = sum(i(r, "compressed_bytes") for r in rows)
saved = max(0, orig - eff)
ratio = (eff / orig) if orig else 1.0
saved_pct = (100.0 * saved / orig) if orig else 0.0
changed = sum(1 for r in rows if r.get("changed") == "1")
passed = sum(1 for r in rows if r.get("pass") == "1")
aggregate_ok = ratio <= 0.60
status = "PASS" if probe_fail == 0 and passed == len(rows) and aggregate_ok else "FAIL"

try:
    git_head = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
except Exception:
    git_head = "unknown"

lines = []
lines.append("# DS4 tool-output compression real-corpus certification")
lines.append("")
lines.append(f"Status: **{status}**")
lines.append("")
lines.append("## Scope")
lines.append("")
lines.append("This second certification uses corpus material generated from the current repository: real grep output, a unified diff derived from `ds4_tool_compress.c`, a large `read`-style source payload, git-tracked file metadata JSON, and an existing trace when present. It verifies the same reversible-compression invariants as the synthetic certification while using repo-shaped data.")
lines.append("")
lines.append("Aggregate pass threshold: effective bytes <= 60% of original bytes.")
lines.append("")
lines.append("## Environment")
lines.append("")
lines.append(f"- Generated at: {_dt.datetime.now(_dt.timezone.utc).isoformat()}")
lines.append(f"- Git HEAD: `{git_head}`")
lines.append(f"- Platform: `{platform.platform()}`")
lines.append(f"- Raw results: `{raw_path.as_posix()}`")
lines.append(f"- Command: `scripts/certify_tool_compression_real_corpus.sh`")
lines.append("")
lines.append("## Aggregate result")
lines.append("")
lines.append(f"- Cases: **{len(rows)}**, passed **{passed}**, compressed **{changed}**")
lines.append(f"- Original bytes: **{orig:,}** ({fmt_bytes(orig)})")
lines.append(f"- Effective compressed bytes: **{eff:,}** ({fmt_bytes(eff)})")
lines.append(f"- Saved bytes: **{saved:,}** ({fmt_bytes(saved)})")
lines.append(f"- Overall byte ratio: **{ratio:.4f}x**")
lines.append(f"- Overall byte saving: **{saved_pct:.2f}%**")
lines.append(f"- Approx original tokens (chars/4): **{approx_tokens(orig):,}**")
lines.append(f"- Approx effective tokens (chars/4): **{approx_tokens(eff):,}**")
lines.append(f"- Approx token saving (chars/4): **{approx_tokens(orig) - approx_tokens(eff):,}**")
lines.append("")
lines.append("## Per-case result")
lines.append("")
lines.append("| Case | Tool | Kind | Strategy | Changed | Original | Effective | Saved | Ratio | Blob exact | Pass | Note |")
lines.append("|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|")
for r in rows:
    original = i(r, "original_bytes")
    effective = i(r, "compressed_bytes")
    saved_case = i(r, "saved_bytes")
    lines.append(
        "| {name} | `{tool}` | {kind} | `{strategy}` | {changed} | {original} | {effective} | {saved} ({saved_pct:.2f}%) | {ratio:.4f}x | {retrievable} | {passed} | {note} |".format(
            name=r.get("name", ""),
            tool=r.get("tool", ""),
            kind=r.get("kind", ""),
            strategy=r.get("strategy", ""),
            changed="yes" if r.get("changed") == "1" else "no",
            original=f"{original:,}",
            effective=f"{effective:,}",
            saved=f"{saved_case:,}",
            saved_pct=f(r, "saved_pct"),
            ratio=f(r, "ratio", 1.0),
            retrievable="yes" if r.get("retrievable") == "1" else ("n/a" if r.get("changed") == "0" else "no"),
            passed="yes" if r.get("pass") == "1" else "no",
            note=r.get("note", ""),
        )
    )
lines.append("")
lines.append("## Certification decision")
lines.append("")
if status == "PASS":
    lines.append("The compressor passes the real-corpus certification: all per-case invariants passed and aggregate compression stayed below the 0.60 threshold.")
else:
    lines.append("The compressor does **not** pass the real-corpus certification. Inspect the raw TSV and per-case notes.")
lines.append("")
lines.append("## Remaining gap")
lines.append("")
lines.append("This still does not load a DS4 model. A final model-backed certification should measure actual tokenizer counts, prompt-fit/compaction deltas, and latency on replayed agent sessions.")
lines.append("")
report_path.write_text("\n".join(lines), encoding="utf-8")
print(f"wrote {report_path}")
print(f"status {status}: saved {saved:,}/{orig:,} bytes ({saved_pct:.2f}%)")
PY
report_rc=$?
if [ "$report_rc" -ne 0 ]; then
    exit "$report_rc"
fi

cat "$RAW"
exit "$fail"
