#!/usr/bin/env bash
# Stand-in for ds4-bench: records its argv/env and writes one CSV row.
set -euo pipefail
csv=""
while [ $# -gt 0 ]; do [ "$1" = --csv ] && csv="$2"; shift; done
echo "ctx_tokens,prefill_tokens,prefill_tps,gen_tokens,gen_tps,gen_first_ms,gen_steady_tokens,gen_steady_tps,kvcache_bytes" >"$csv"
echo "4096,4096,500.0,128,${FAKE_TPS:-20.0},150.0,127,20.1,1048576" >>"$csv"
echo "window=${DS4_DSPARK_SCHEDULER_WINDOW:-unset}"
