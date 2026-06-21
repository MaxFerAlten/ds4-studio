#!/usr/bin/env bash
set -u -o pipefail

# Few-minute operational certification: run all compressed payloads plus only
# small originals, then project huge-original latency from measured DS4 throughput.
export DS4_OPERATIONAL_REPORT_STEM="${DS4_OPERATIONAL_REPORT_STEM:-tool_compression_operational_projected}"
export DS4_OPERATIONAL_RUN_HUGE_ORIGINALS="${DS4_OPERATIONAL_RUN_HUGE_ORIGINALS:-0}"
export DS4_OPERATIONAL_ORIGINAL_RUN_TOKEN_LIMIT="${DS4_OPERATIONAL_ORIGINAL_RUN_TOKEN_LIMIT:-5000}"
export DS4_OPERATIONAL_REQUEST_TIMEOUT="${DS4_OPERATIONAL_REQUEST_TIMEOUT:-900}"
exec "$(dirname "${BASH_SOURCE[0]}")/certify_tool_compression_operational.sh" "$@"
