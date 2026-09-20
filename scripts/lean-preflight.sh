#!/usr/bin/env bash
# Report whether the Lean 4 runtime is ready. Read-only: this script installs
# nothing, downloads nothing and never runs `lake update`.
#
# Exit 0 when every requirement is satisfied. Without --require the bar is the
# core profile; certification passes --require core --require mathlib
# --require security so a partial host cannot look green.
#
# Usage: scripts/lean-preflight.sh [--require core|mathlib|security]...
set -euo pipefail

REQUIRE_CORE=1
REQUIRE_MATHLIB=0
REQUIRE_SECURITY=0
EXPLICIT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --require)
      shift
      case "${1:-}" in
        core) EXPLICIT=1; REQUIRE_CORE=1 ;;
        mathlib) EXPLICIT=1; REQUIRE_MATHLIB=1 ;;
        security) EXPLICIT=1; REQUIRE_SECURITY=1 ;;
        *) echo "ERROR: --require expects core|mathlib|security" >&2; exit 2 ;;
      esac
      ;;
    -h|--help)
      echo "Usage: $(basename "$0") [--require core|mathlib|security]..."
      exit 0
      ;;
    *) echo "ERROR: unknown argument '$1'" >&2; exit 2 ;;
  esac
  shift
done
# An explicit --require list replaces the default, it does not extend it.
if [[ $EXPLICIT -eq 1 ]]; then
  :
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

: "${DS4_LEAN_RUNTIME_ROOT:=$REPO_ROOT/lean-runtime}"
: "${DS4_LEAN_RUNS_ROOT:=$REPO_ROOT/frontend/workspace/lean-runs}"
: "${DS4_LEAN_ELAN_ROOT:=${ELAN_HOME:-$HOME/.elan}}"
export DS4_LEAN_RUNTIME_ROOT DS4_LEAN_RUNS_ROOT DS4_LEAN_ELAN_ROOT

# The preflight module itself refuses to report on a disabled feature, but this
# script exists to answer "could I turn it on?", so force the flag on locally.
export DS4_LEAN_ENABLED=1

status=0
sandbox_ok=1

echo "=== ds4-studio Lean 4 preflight ==="
echo "runtime root : $DS4_LEAN_RUNTIME_ROOT"
echo "runs root    : $DS4_LEAN_RUNS_ROOT"
echo "elan root    : $DS4_LEAN_ELAN_ROOT"
echo

for bin in "${DS4_LEAN_BWRAP_BIN:-/usr/bin/bwrap}" "${DS4_LEAN_PRLIMIT_BIN:-/usr/bin/prlimit}"; do
  if [ -x "$bin" ]; then
    echo "sandbox      : OK  $bin"
  else
    echo "sandbox      : MISSING  $bin"
    sandbox_ok=0
  fi
done

# Unprivileged user namespaces are what bwrap actually needs; a distro that
# disables them fails at run time with an unhelpful EPERM, so check here.
if command -v bwrap >/dev/null 2>&1; then
  if bwrap --unshare-user --unshare-net --ro-bind /usr /usr \
           --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
           -- /bin/true >/dev/null 2>&1; then
    echo "userns       : OK"
  else
    echo "userns       : FAILED (bwrap cannot create a namespace on this host)"
    sandbox_ok=0
  fi
fi
echo

REQ_CORE="$REQUIRE_CORE" REQ_MATHLIB="$REQUIRE_MATHLIB" \
node --input-type=module -e '
import { loadLeanConfig } from "./frontend/server/lean/leanConfig.mjs";
import { runLeanPreflight } from "./frontend/server/lean/leanPreflight.mjs";

const config = loadLeanConfig(process.env);
const report = await runLeanPreflight(config);

for (const [name, p] of Object.entries(report.profiles || {})) {
  console.log(`profile ${name.padEnd(8)}: ${p.ok ? "READY" : "NOT READY"}${p.toolchain ? `  ${p.toolchain}` : ""}`);
  if (!p.ok) console.log(`               ${p.reason}`);
}
console.log("");
for (const w of report.warnings || []) console.log(`warning      : ${w}`);
for (const e of report.errors || []) console.log(`error        : ${e}`);

const need = { core: process.env.REQ_CORE === "1", mathlib: process.env.REQ_MATHLIB === "1" };
const missing = Object.entries(need)
  .filter(([name, required]) => required && report.profiles?.[name]?.ok !== true)
  .map(([name]) => name);
console.log("");
if (missing.length) {
  console.log(`LEAN_PREFLIGHT_NOT_READY missing=${missing.join(",")}`);
  process.exit(1);
}
console.log("LEAN_PREFLIGHT_OK");
' || status=1

# The sandbox verdict only fails the run when it was required; otherwise it is
# reported and the profile verdicts decide.
if [[ $REQUIRE_SECURITY -eq 1 && $sandbox_ok -eq 0 ]]; then
  echo "requirement  : security NOT satisfied (bwrap/userns)"
  status=1
elif [[ $sandbox_ok -eq 0 ]]; then
  echo "warning      : sandbox unavailable; Lean cannot run fail-closed"
  status=1
fi

exit "$status"
