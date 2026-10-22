#!/usr/bin/env bash
# bench_matrix.sh: seeded order, per-config env, one CSV per run, 0700 output.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
printf 'baseline\nsched-w8\tDS4_DSPARK_SCHEDULER_WINDOW=8 --dspark\n# comment\n' >"$tmp/configs.tsv"
run() { "$here/../scripts/bench_matrix.sh" --configs "$tmp/configs.tsv" --out "$1" --rounds 3 --seed 7 \
        --bench "$here/fake_ds4_bench.sh" -- -m /nonexistent.gguf --gen-tokens 8 2>"$1.err"; }
run "$tmp/a"; run "$tmp/b"
[ "$(ls "$tmp/a/baseline" | grep -c csv)" = 3 ] || { echo "FAIL baseline runs"; exit 1; }
[ "$(ls "$tmp/a/sched-w8" | grep -c csv)" = 3 ] || { echo "FAIL sched runs"; exit 1; }
grep -q 'window=8' "$tmp/a/sched-w8/run-01.log" || { echo "FAIL env not applied"; exit 1; }
grep -q 'window=unset' "$tmp/a/baseline/run-01.log" || { echo "FAIL env leaked"; exit 1; }
[ "$(stat -c %a "$tmp/a")" = 700 ] || { echo "FAIL perms"; exit 1; }
diff <(grep round "$tmp/a.err") <(grep round "$tmp/b.err") >/dev/null || { echo "FAIL order not seeded"; exit 1; }
python3 -c "import json,sys; m=json.load(open(sys.argv[1])); assert m['rounds']==3 and m['seed']==7" "$tmp/a/metadata.json"
if run "$tmp/a" 2>/dev/null; then echo "FAIL reused out dir accepted"; exit 1; fi
grep -q 'not empty' "$tmp/a.err" || { echo "FAIL reuse message"; exit 1; }
echo "PASS bench_matrix"
