#!/usr/bin/env bash
# Stop ONLY the h2ds4 sidecar: the systemd user unit if active, otherwise the pid that holds
# the h2ds4 data-dir lock. Never pkill/killall; DS4 is never touched.
set -euo pipefail
if systemctl --user is-active --quiet h2ds4.service 2>/dev/null; then
  exec systemctl --user stop h2ds4.service
fi
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/h2ds4"
LOCK="$DATA/h2ds4.lock"
[[ -f "$LOCK" && ! -L "$LOCK" ]] || { echo "no h2ds4 lock file: sidecar not running" >&2; exit 0; }
PID="$(head -c 16 "$LOCK" | tr -dc 0-9)"
[[ -n "$PID" ]] || { echo "lock has no pid" >&2; exit 0; }
CMD="$(tr '\0' ' ' < "/proc/$PID/cmdline" 2>/dev/null || true)"
case "$CMD" in
  *h2ds4*serve*) kill -TERM "$PID"; echo "sent SIGTERM to h2ds4 pid $PID" ;;
  *) echo "pid $PID is not an h2ds4 sidecar; refusing to signal it" >&2; exit 4 ;;
esac
