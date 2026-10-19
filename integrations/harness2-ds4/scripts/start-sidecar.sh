#!/usr/bin/env bash
# Start the sidecar in the foreground on its Unix socket. Never started by DS4/srun.sh.
# Refuses unless config sets service.enabled=true; never unlinks a socket it cannot prove stale.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${XDG_RUNTIME_DIR:?XDG_RUNTIME_DIR must be set by the user session}"
exec "$ROOT/.venv/bin/h2ds4" ${H2DS4_CONFIG:+--config "$H2DS4_CONFIG"} serve "$@"
