#!/usr/bin/env bash
# Prepare the pinned Lean 4 runtime profiles (core and/or mathlib) and record
# their state in runtime.metadata.json.
#
# Default mode is --locked: no network, no `lake update`, no elan installs.
# It fails if a pinned manifest or the build cache is missing. --update-lock
# is an explicit maintainer operation that may hit the network to refresh the
# lock and prints the manifest diff and checksums.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_ROOT="${DS4_LEAN_RUNTIME_ROOT:-$REPO_ROOT/lean-runtime}"
BWRAP_BIN="${DS4_LEAN_BWRAP_BIN:-/usr/bin/bwrap}"
BUILD_TIMEOUT_SEC="${DS4_LEAN_BUILD_TIMEOUT_SEC:-1800}"
export DS4_LEAN_RUNTIME_ROOT="$RUNTIME_ROOT"

MODE="locked"
MODE_FLAG=""
PROFILE=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [--all | --profile core | --profile mathlib] [--locked | --update-lock]

Prepares the Lean runtime for ds4-studio and writes runtime.metadata.json.

Modes (default: --locked):
  --locked       Offline build. No network, no \`lake update\`, no elan
                 install. Fails if a pinned manifest or the build cache is
                 missing. Leaves the runtime read-only.
  --update-lock  Explicit maintainer operation. Runs \`lake update\` (network),
                 prints manifest diff/checksums, then builds on the host and
                 leaves the runtime writable.

Options:
  --all           Build both core and mathlib profiles
  --profile core  Build only the core profile
  --profile mathlib Build only the mathlib profile
  --help          Show this help message
EOF
  exit 1
}

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
    --locked)
      if [[ -n "$MODE_FLAG" ]]; then echo "ERROR: --locked and --update-lock are mutually exclusive."; usage; fi
      MODE="locked"; MODE_FLAG=1 ;;
    --update-lock)
      if [[ -n "$MODE_FLAG" ]]; then echo "ERROR: --locked and --update-lock are mutually exclusive."; usage; fi
      MODE="update-lock"; MODE_FLAG=1 ;;
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

for cmd in elan lean lake; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: Required tool '$cmd' not found (looked on PATH and in $ELAN_ROOT/bin)."
    echo "       Install the toolchains first: scripts/lean-install-toolchain.sh --all"
    exit 1
  fi
done

if [[ "$MODE" == "locked" && ! -x "$BWRAP_BIN" ]]; then
  echo "ERROR: --locked requires bwrap ($BWRAP_BIN) for the offline build."
  exit 1
fi

write_metadata() {
  local name="$1" descriptor="$2" lean_version="$3" lake_version="$4"
  node --input-type=module -e '
    import { loadLeanConfig } from "./frontend/server/lean/leanConfig.mjs";
    import { writeLeanRuntimeMetadata } from "./frontend/server/lean/leanMetadata.mjs";
    const config = loadLeanConfig(process.env);
    const [name, mode, descriptor, leanVersion, lakeVersion] = process.argv.slice(1);
    const res = await writeLeanRuntimeMetadata(config, name, { mode, descriptor, leanVersion, lakeVersion });
    if (!res.ok) { console.error("ERROR: " + res.error); process.exit(1); }
    console.log("[lean-prepare] " + name + ": runtime.metadata.json recorded (files: " + Object.keys(res.metadata.files).length + ")");
  ' -- "$name" "$MODE" "$descriptor" "$lean_version" "$lake_version"
}

build_profile() {
  local name="$1"
  local dir="$RUNTIME_ROOT/$name"
  local descriptor lean_bin toolchain_dir lean_version lake_version smoke

  if [[ ! -d "$dir" ]]; then
    echo "ERROR: Profile directory '$dir' does not exist."
    return 1
  fi
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
    echo "ERROR: $dir/lean-toolchain '$descriptor' is a floating channel; the runtime must be pinned."
    return 1
  fi

  if [[ "$MODE" == "locked" && ! -f "$dir/lake-manifest.json" ]]; then
    echo "ERROR: $name/lake-manifest.json is missing. Run scripts/lean-prepare-runtime.sh --all --update-lock once (network)."
    return 1
  fi
  if [[ "$MODE" == "locked" && ! -d "$dir/.lake" ]]; then
    echo "ERROR: $name/.lake build cache is missing. Run scripts/lean-prepare-runtime.sh --all --update-lock once (network)."
    return 1
  fi

  # A previous locked run left the runtime read-only; prepare is the only
  # writer, so re-enable it for the build step.
  chmod -R u+w "$dir"

  # Resolve the actual toolchain inside the profile (respects lean-toolchain).
  lean_bin="$(elan which lean)"
  toolchain_dir="$(dirname "$(dirname "$lean_bin")")"
  if [[ "$toolchain_dir" != "$ELAN_ROOT/toolchains/"* ]]; then
    echo "ERROR: elan resolved '$lean_bin' outside $ELAN_ROOT/toolchains; refusing to use a non-elan toolchain."
    return 1
  fi
  lean_version="$(lean --version)"
  lake_version="$(lake --version)"
  if [[ -z "$(printf '%s' "$lean_version" | grep -oE 'commit [0-9a-f]{40}')" ]]; then
    echo "ERROR: '$lean_version' has no pinned 40-hex commit; refusing a floating build."
    return 1
  fi
  echo "[lean-prepare] $name: mode=$MODE toolchain=$descriptor"
  echo "  lean: $lean_version"
  echo "  lake: $lake_version"

  smoke="$([[ -f "$dir/Ds4LeanCore.lean" ]] && echo Ds4LeanCore.lean || echo Ds4LeanMathlib.lean)"
  case "$name" in
    mathlib) smoke="Ds4LeanMathlib.lean" ;;
  esac
  if [[ ! -f "$dir/$smoke" ]]; then
    echo "ERROR: smoke source $dir/$smoke is missing."
    return 1
  fi

  if [[ "$MODE" == "update-lock" ]]; then
    local before after
    before="$(sha256sum "$dir/lake-manifest.json" 2>/dev/null | cut -d' ' -f1 || echo missing)"
    echo "[lean-prepare] $name: running lake update (network)..."
    ( cd "$dir" && lake update )
    after="$(sha256sum "$dir/lake-manifest.json" | cut -d' ' -f1)"
    echo "[lean-prepare] $name: manifest sha256 $before -> $after"
    if git -C "$REPO_ROOT" rev-parse --is-inside-work-tree &>/dev/null && [[ "$after" != "$before" ]]; then
      git -C "$REPO_ROOT" diff --stat -- "lean-runtime/$name/lake-manifest.json" || true
    fi
    echo "[lean-prepare] $name: running lake build (host)..."
    ( cd "$dir" && lake build )
    echo "[lean-prepare] $name: smoke theorem ($smoke)..."
    ( cd "$dir" && lake env lean "$smoke" )
  else
    echo "[lean-prepare] $name: offline lake build (bwrap, network disabled)..."
    timeout "$BUILD_TIMEOUT_SEC" "$BWRAP_BIN" \
      --unshare-net --unshare-user --unshare-pid \
      --proc /proc --dev /dev --tmpfs /tmp \
      --ro-bind /usr /usr \
      --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
      --ro-bind "$toolchain_dir" /lean-toolchain \
      --bind "$dir" /lean-project \
      --setenv PATH /lean-toolchain/bin:/usr/bin:/bin \
      --setenv HOME /tmp --setenv LANG C.UTF-8 --setenv LC_ALL C.UTF-8 \
      --chdir /lean-project \
      -- /lean-toolchain/bin/lake build
    echo "[lean-prepare] $name: smoke theorem ($smoke, offline)..."
    timeout "$BUILD_TIMEOUT_SEC" "$BWRAP_BIN" \
      --unshare-net --unshare-user --unshare-pid \
      --proc /proc --dev /dev --tmpfs /tmp \
      --ro-bind /usr /usr \
      --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 \
      --ro-bind "$toolchain_dir" /lean-toolchain \
      --ro-bind "$dir" /lean-project \
      --setenv PATH /lean-toolchain/bin:/usr/bin:/bin \
      --setenv HOME /tmp --setenv LANG C.UTF-8 --setenv LC_ALL C.UTF-8 \
      --chdir /lean-project \
      -- /lean-toolchain/bin/lake env lean "$smoke"
  fi

  write_metadata "$name" "$descriptor" "$lean_version" "$lake_version"

  if [[ "$MODE" == "locked" ]]; then
    chmod -R a-w "$dir"
    echo "[lean-prepare] $name: runtime left read-only."
  fi
}

case "$PROFILE" in
  all) build_profile core; build_profile mathlib ;;
  core) build_profile core ;;
  mathlib) build_profile mathlib ;;
esac

echo "[lean-prepare] Done (mode=$MODE)."
