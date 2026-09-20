#!/usr/bin/env bash
# Install the pinned Lean toolchains with elan. Explicit, maintainer-only
# operation, kept separate from prepare: this script never builds a profile
# and never runs `lake update`.
#
# The descriptors are read from each profile's lean-toolchain file, so the
# only source of truth for "which toolchain" stays inside lean-runtime/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_ROOT="${DS4_LEAN_RUNTIME_ROOT:-$REPO_ROOT/lean-runtime}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--all | --profile core | --profile mathlib]

Installs the pinned Lean toolchains (from each profile's lean-toolchain)
using elan. Network access is required; this is a one-time, per-machine step
that must run before scripts/lean-prepare-runtime.sh --locked.

Options:
  --all              Install toolchains for both core and mathlib
  --profile core     Install only the core toolchain
  --profile mathlib  Install only the mathlib toolchain
  --help             Show this help message
EOF
  exit 1
}

PROFILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) PROFILE="all" ;;
    --profile)
      if [[ -z "$2" || ( "$2" != "core" && "$2" != "mathlib" ) ]]; then
        echo "ERROR: Invalid profile '$2'. Must be 'core' or 'mathlib'."
        exit 1
      fi
      PROFILE="$2"
      shift
      ;;
    --help) usage ;;
    *) echo "ERROR: Unknown option '$1'"; usage ;;
  esac
  shift
done

if [[ -z "$PROFILE" ]]; then
  echo "ERROR: Missing --profile or --all flag."
  usage
fi

# elan installs its shims under ~/.elan/bin and does not always put them on
# PATH for non-interactive shells; the server resolves the toolchain the same
# way (DS4_LEAN_ELAN_ROOT), so keep the two consistent.
ELAN_ROOT="${DS4_LEAN_ELAN_ROOT:-${ELAN_HOME:-$HOME/.elan}}"
if [[ -d "$ELAN_ROOT/bin" ]]; then
  export PATH="$ELAN_ROOT/bin:$PATH"
fi

if ! command -v elan &>/dev/null; then
  echo "ERROR: elan not found (looked on PATH and in $ELAN_ROOT/bin)."
  echo "       Install elan first: https://lean-lang.org/elan/ (e.g. elan-init)"
  exit 1
fi

install_for() {
  local name="$1"
  local dir="$RUNTIME_ROOT/$name"
  local descriptor

  if [[ ! -f "$dir/lean-toolchain" ]]; then
    echo "ERROR: $dir/lean-toolchain missing; cannot resolve the pinned toolchain."
    return 1
  fi
  descriptor="$(cat "$dir/lean-toolchain")"
  if [[ -z "$descriptor" || "$descriptor" == "<placeholder>" ]]; then
    echo "ERROR: $dir/lean-toolchain is empty or a placeholder."
    return 1
  fi
  if [[ "$descriptor" =~ (^|[^0-9])(master|main|latest|stable|nightly)([^0-9]|$) ]]; then
    echo "ERROR: $name/lean-toolchain '$descriptor' is a floating channel; the runtime must be pinned."
    return 1
  fi

  echo "[lean-install] $name: elan toolchain install $descriptor"
  local output rc=0
  output="$(elan toolchain install "$descriptor" 2>&1)" || rc=$?
  if [[ $rc -ne 0 ]]; then
    if [[ "$output" == *"already installed"* ]]; then
      echo "[lean-install] $name: $output"
    else
      echo "ERROR: elan failed to install '$descriptor': $output"
      return 1
    fi
  fi
}

case "$PROFILE" in
  all) install_for core; install_for mathlib ;;
  core) install_for core ;;
  mathlib) install_for mathlib ;;
esac

echo "[lean-install] Done. Run scripts/lean-prepare-runtime.sh --all --locked to build and lock."
