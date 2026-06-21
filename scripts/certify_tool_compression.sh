#!/usr/bin/env bash
set -u -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${1:-docs/certifications}"
mkdir -p "$OUT_DIR"
RAW="$OUT_DIR/tool_compression_certification.tsv"
REPORT="$OUT_DIR/tool_compression_certification.md"
BIN="$(mktemp /tmp/ds4_tool_compression_cert.XXXXXX)"
TMP="$(mktemp -d /tmp/ds4_tool_compression_cert_blobs.XXXXXX)"
trap 'rm -rf "$BIN" "$TMP"' EXIT

CC_BIN="${CC:-cc}"
CFLAGS_LOCAL="${CFLAGS:-}"

"$CC_BIN" -O2 -g -Wall -Wextra -std=c99 -D_GNU_SOURCE -I. $CFLAGS_LOCAL \
    -o "$BIN" \
    tests/tool_compression_cert.c ds4_tool_compress.c ds4_context_blob.c
compile_rc=$?
if [ "$compile_rc" -ne 0 ]; then
    echo "compile failed" >&2
    exit "$compile_rc"
fi

set +e
"$BIN" "$TMP/context-blobs" > "$RAW"
run_rc=$?
set -e

python3 - "$RAW" "$REPORT" "$run_rc" <<'PY'
from __future__ import annotations
import datetime as _dt
import math
import pathlib
import platform
import subprocess
import sys

raw_path = pathlib.Path(sys.argv[1])
report_path = pathlib.Path(sys.argv[2])
run_rc = int(sys.argv[3])

cases = []
summary = None
for raw in raw_path.read_text(encoding="utf-8").splitlines():
    if not raw.strip():
        continue
    parts = raw.split("\t")
    tag = parts[0]
    row = {"_tag": tag}
    for part in parts[1:]:
        if "=" in part:
            k, v = part.split("=", 1)
            row[k] = v
    if tag == "case":
        cases.append(row)
    elif tag == "summary":
        summary = row

if summary is None:
    summary = {"pass": "0", "cases": str(len(cases)), "passed": "0", "changed": "0",
               "original_bytes": "0", "compressed_bytes": "0", "saved_bytes": "0",
               "overall_ratio": "1.0", "overall_saved_pct": "0"}

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

def pct(x):
    return f"{x:.2f}%"

def bytes_fmt(n):
    n = int(n)
    units = ["B", "KiB", "MiB", "GiB"]
    v = float(n)
    for u in units:
        if v < 1024 or u == units[-1]:
            return f"{v:.1f} {u}" if u != "B" else f"{n} B"
        v /= 1024

def approx_tokens(n):
    return math.ceil(int(n) / 4)

try:
    git_head = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
except Exception:
    git_head = "unknown"

status = "PASS" if run_rc == 0 and summary.get("pass") == "1" else "FAIL"
orig = i(summary, "original_bytes")
comp = i(summary, "compressed_bytes")
saved = i(summary, "saved_bytes")
ratio = f(summary, "overall_ratio", 1.0)
saved_pct = f(summary, "overall_saved_pct", 0.0)

lines = []
lines.append("# DS4 tool-output compression certification")
lines.append("")
lines.append(f"Status: **{status}**")
lines.append("")
lines.append("## Scope")
lines.append("")
lines.append("This certification exercises the DS4-native live-zone tool-output compressor and reversible context blob store without loading a model. It measures byte-level reduction and uses a chars/4 proxy for token savings; exact DS4 tokenizer measurements require a model-backed tokenizer run.")
lines.append("")
lines.append("Covered behaviours:")
lines.append("")
lines.append("- small outputs below threshold remain unchanged;")
lines.append("- long log/search/diff/JSON/file/generic outputs are compressed;")
lines.append("- compressed outputs never expand beyond the original;")
lines.append("- lossy compressed originals are saved as blobs and exactly retrievable;")
lines.append("- `retrieve_context_blob` results are not recursively compressed;")
lines.append("- aggregate effective size must be <= 50% of original size for the certification corpus.")
lines.append("")
lines.append("## Environment")
lines.append("")
lines.append(f"- Generated at: {_dt.datetime.now(_dt.timezone.utc).isoformat()}")
lines.append(f"- Git HEAD: `{git_head}`")
lines.append(f"- Platform: `{platform.platform()}`")
lines.append(f"- Raw results: `{raw_path.as_posix()}`")
lines.append(f"- Command: `scripts/certify_tool_compression.sh`")
lines.append("")
lines.append("## Aggregate result")
lines.append("")
lines.append(f"- Original bytes: **{orig:,}** ({bytes_fmt(orig)})")
lines.append(f"- Effective compressed bytes: **{comp:,}** ({bytes_fmt(comp)})")
lines.append(f"- Saved bytes: **{saved:,}** ({bytes_fmt(saved)})")
lines.append(f"- Overall byte ratio: **{ratio:.4f}x**")
lines.append(f"- Overall byte saving: **{pct(saved_pct)}**")
lines.append(f"- Approx original tokens (chars/4): **{approx_tokens(orig):,}**")
lines.append(f"- Approx effective tokens (chars/4): **{approx_tokens(comp):,}**")
lines.append(f"- Approx token saving (chars/4): **{approx_tokens(orig) - approx_tokens(comp):,}**")
lines.append("")
lines.append("## Per-case result")
lines.append("")
lines.append("| Case | Tool | Kind | Strategy | Changed | Original | Compressed/effective | Saved | Ratio | Blob exact | Pass |")
lines.append("|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|")
for c in cases:
    original = i(c, "original_bytes")
    compressed = i(c, "compressed_bytes")
    saved_case = i(c, "saved_bytes")
    lines.append(
        "| {name} | `{tool}` | {kind} | `{strategy}` | {changed} | {original} | {compressed} | {saved} | {ratio:.4f}x | {retrievable} | {passed} |".format(
            name=c.get("name", ""),
            tool=c.get("tool", ""),
            kind=c.get("kind", ""),
            strategy=c.get("strategy", ""),
            changed="yes" if c.get("changed") == "1" else "no",
            original=f"{original:,}",
            compressed=f"{compressed:,}",
            saved=f"{saved_case:,} ({pct(f(c, 'saved_pct', 0.0))})",
            ratio=f(c, "ratio", 1.0),
            retrievable="yes" if c.get("retrievable") == "1" else ("n/a" if c.get("changed") == "0" else "no"),
            passed="yes" if c.get("pass") == "1" else "no",
        )
    )
lines.append("")
lines.append("## Certification decision")
lines.append("")
if status == "PASS":
    lines.append("The compressor passes this certification corpus: all required behaviour checks passed and the aggregate byte ratio stayed below the 0.50 threshold.")
else:
    lines.append("The compressor does **not** pass this certification corpus. Inspect the per-case failures and raw TSV for details.")
lines.append("")
lines.append("## Limitations / next certification layer")
lines.append("")
lines.append("- This is a deterministic byte-level certification, not an end-to-end agent-quality evaluation.")
lines.append("- It does not measure real DS4 tokenizer counts, model answer quality, hard-compaction reduction, or prefill latency.")
lines.append("- Next layer should replay real agent traces before/after compression and compare prompt tokens, compaction count, latency, and retrieval frequency.")
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
exit "$run_rc"
