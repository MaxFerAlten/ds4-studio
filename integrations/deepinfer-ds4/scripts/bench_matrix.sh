#!/usr/bin/env bash
# bench_matrix.sh - Gate 0 / Mode A benchmark matrix (plan §2.4, §10).
#
# Runs ds4-bench once per (config, round) in a seeded random order and keeps
# one CSV per run, so spec_select can compare configurations with a bootstrap
# CI. It only measures: it never changes DS4 defaults and never restarts a
# running server. Prompt text is never copied into the output directory.
#
# Usage:
#   bench_matrix.sh --configs FILE --out DIR [--rounds 7] [--seed 1]
#                   [--bench ./ds4-bench] [--hash-model] -- <common ds4-bench args>
#
# FILE: one configuration per line, "label<TAB>extra ds4-bench args", e.g.
#   baseline
#   dspark-c07	--dspark --dspark-confidence 0.7 --mtp-model gguf/X-DSpark.gguf
# Per-config environment knobs go in front as KEY=VALUE words:
#   sched-w8	DS4_DSPARK_SCHEDULER_WINDOW=8 --dspark --mtp-model gguf/X.gguf
set -euo pipefail

configs="" out="" rounds=7 seed=1 bench="./ds4-bench" hash_model=0
while [ $# -gt 0 ]; do
    case "$1" in
        --configs) configs="$2"; shift 2 ;;
        --out) out="$2"; shift 2 ;;
        --rounds) rounds="$2"; shift 2 ;;
        --seed) seed="$2"; shift 2 ;;
        --bench) bench="$2"; shift 2 ;;
        --hash-model) hash_model=1; shift ;;
        --) shift; break ;;
        *) echo "bench_matrix: unknown option $1" >&2; exit 2 ;;
    esac
done
common=("$@")

[ -n "$configs" ] && [ -f "$configs" ] || { echo "bench_matrix: --configs FILE required" >&2; exit 2; }
[ -n "$out" ] || { echo "bench_matrix: --out DIR required" >&2; exit 2; }
[ -x "$bench" ] || { echo "bench_matrix: $bench not executable" >&2; exit 2; }
case "$rounds" in ''|*[!0-9]*) echo "bench_matrix: --rounds must be an integer" >&2; exit 2 ;; esac

mkdir -p "$out"
chmod 700 "$out"

model=""
for ((i = 0; i < ${#common[@]}; i++)); do
    case "${common[$i]}" in -m|--model) model="${common[$((i + 1))]:-}" ;; esac
done
model_sha=""
if [ "$hash_model" = 1 ] && [ -n "$model" ] && [ -f "$model" ]; then
    model_sha=$(sha256sum "$model" | cut -d' ' -f1)
fi

repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
python3 - "$out/metadata.json" "$repo_root" "$model" "$model_sha" "$rounds" "$seed" <<'PY'
import json, os, platform, subprocess, sys, time
path, root, model, model_sha, rounds, seed = sys.argv[1:]
def git(*a):
    try:
        return subprocess.run(["git", "-C", root, *a], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        return None
meta = {
    "schema_version": 1,
    "utc_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "git_sha_ds4": git("rev-parse", "HEAD"),
    "git_dirty": bool(git("status", "--porcelain")),
    "linux_kernel": platform.release(),
    "model_basename": os.path.basename(model) if model else None,
    "model_sha256": model_sha or None,
    "rounds": int(rounds),
    "seed": int(seed),
}
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    json.dump(meta, f, indent=2, sort_keys=True)
PY

mapfile -t lines < <(grep -v '^[[:space:]]*\(#\|$\)' "$configs")
[ "${#lines[@]}" -gt 0 ] || { echo "bench_matrix: no configurations in $configs" >&2; exit 2; }

# Seeded shuffle of (config index, round) pairs: interleaving configurations
# keeps thermal drift from biasing whichever one would otherwise run last.
plan=()
for ((r = 1; r <= rounds; r++)); do
    for ((c = 0; c < ${#lines[@]}; c++)); do plan+=("$c $r"); done
done
mapfile -t plan < <(printf '%s\n' "${plan[@]}" |
    shuf --random-source=<(openssl enc -aes-256-ctr -pass "pass:$seed" -nosalt </dev/zero 2>/dev/null))

failures=0
for item in "${plan[@]}"; do
    read -r c r <<<"$item"
    line="${lines[$c]}"
    label="${line%%$'\t'*}"
    rest=""
    [ "$label" != "$line" ] && rest="${line#*$'\t'}"
    case "$label" in ''|*[!A-Za-z0-9._-]*) echo "bench_matrix: bad label '$label'" >&2; exit 2 ;; esac

    envs=() args=()
    read -r -a words <<<"$rest"
    for w in "${words[@]}"; do
        if [ "${#args[@]}" -eq 0 ] && [[ "$w" =~ ^DS4_[A-Z0-9_]+=.*$ ]]; then envs+=("$w"); else args+=("$w"); fi
    done

    mkdir -p "$out/$label"
    csv="$out/$label/run-$(printf '%02d' "$r").csv"
    echo "bench_matrix: $label round $r" >&2
    if ! env "${envs[@]}" "$bench" "${common[@]}" "${args[@]}" --csv "$csv" \
            >"$out/$label/run-$(printf '%02d' "$r").log" 2>&1; then
        echo "bench_matrix: $label round $r FAILED (see log)" >&2
        failures=$((failures + 1))
        rm -f "$csv"
    fi
done

echo "bench_matrix: done, $failures failed run(s), results in $out" >&2
[ "$failures" -eq 0 ]
