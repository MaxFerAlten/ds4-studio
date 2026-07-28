#!/usr/bin/env bash
# Validates third_party/agno-agent-ui/upstream.lock per DS4 plan Fase 1 (SS6.3).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_FILE="$ROOT/third_party/agno-agent-ui/upstream.lock"

# Parses a KEY=VALUE lock file and rejects it if any rule from plan SS6.1/SS6.3
# is violated. Echoes the failure reason and returns 1 on rejection.
validate_lock() {
  local path="$1"
  [[ -f "$path" ]] || { echo "missing lock file"; return 1; }

  local REPOSITORY="" COMMIT="" PNPM_VERSION="" NEXT_VERSION=""
  while IFS='=' read -r key value; do
    [[ -z "$key" ]] && continue
    [[ "$key" =~ ^[A-Z0-9_]+$ ]] || { echo "invalid key: $key"; return 1; }
    [[ "$value" == *'`'* || "$value" == *'$('* ]] && { echo "unsafe value for $key"; return 1; }
    case "$key" in
      AGNO_AGENT_UI_REPOSITORY) REPOSITORY="$value" ;;
      AGNO_AGENT_UI_COMMIT) COMMIT="$value" ;;
      AGNO_AGENT_UI_PNPM_VERSION) PNPM_VERSION="$value" ;;
      AGNO_AGENT_UI_NEXT_VERSION) NEXT_VERSION="$value" ;;
    esac
  done < "$path"

  [[ "$REPOSITORY" == "agno-agi/agent-ui" ]] || { echo "unexpected repository: $REPOSITORY"; return 1; }
  [[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid commit: $COMMIT"; return 1; }
  [[ "$PNPM_VERSION" == "10.14.0" ]] || { echo "unexpected pnpm version: $PNPM_VERSION"; return 1; }
  [[ "$NEXT_VERSION" == "15.5.18" ]] || { echo "unexpected next version: $NEXT_VERSION"; return 1; }
  return 0
}

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

mutate() {
  local field="$1" bad_value="$2"
  local out="$WORKDIR/mutated.lock"
  sed "s|^${field}=.*|${field}=${bad_value}|" "$LOCK_FILE" > "$out"
  echo "$out"
}

echo "[1/6] real lock file is valid"
validate_lock "$LOCK_FILE" >/dev/null || { echo "FAIL: real lock file rejected"; exit 1; }

echo "[2/6] invalid commit length rejected"
BAD="$(mutate AGNO_AGENT_UI_COMMIT deadbeef)"
validate_lock "$BAD" >/dev/null && { echo "FAIL: short commit accepted"; exit 1; }

echo "[3/6] unexpected repository rejected"
BAD="$(mutate AGNO_AGENT_UI_REPOSITORY some-other-repo)"
validate_lock "$BAD" >/dev/null && { echo "FAIL: wrong repository accepted"; exit 1; }

echo "[4/6] unexpected pnpm version rejected"
BAD="$(mutate AGNO_AGENT_UI_PNPM_VERSION 9.0.0)"
validate_lock "$BAD" >/dev/null && { echo "FAIL: wrong pnpm version accepted"; exit 1; }

echo "[5/6] unexpected next version rejected"
BAD="$(mutate AGNO_AGENT_UI_NEXT_VERSION 14.0.0)"
validate_lock "$BAD" >/dev/null && { echo "FAIL: wrong next version accepted"; exit 1; }

echo "[6/6] disallowed shell characters rejected"
BAD="$(mutate AGNO_AGENT_UI_REPOSITORY '\$(whoami)')"
validate_lock "$BAD" >/dev/null && { echo "FAIL: command substitution accepted"; exit 1; }

echo "agno-agent-ui upstream lock certification: PASS"
