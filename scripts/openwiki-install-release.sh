#!/usr/bin/env bash
# Opt-in local provisioning of the pinned OpenWiki release (WP02).
#
# Builds OpenWiki from the exact pinned commit into
#   $OPENWIKI_HOME/releases/<release-id>/{package/,manifest.json}
# and optionally points $OPENWIKI_HOME/current at it. The release id is a
# digest of the pin inputs (commit, package.json, pnpm-lock.yaml, Node ABI,
# platform), so the same pin always maps to the same directory.
#
# Guarantees:
# - runs only with --confirm; never at DS4 boot;
# - verifies the source with scripts/openwiki-verify-upstream.sh first and
#   aborts on any failure (exit 3 = STOP, MCP unsupported);
# - never writes to the upstream checkout: sources come from `git archive`;
# - never overwrites: an existing release dir must verify identically, a
#   symlinked release path or non-symlink `current` is refused (the latter
#   before any build), $OPENWIKI_HOME/state is never touched;
# - re-verifies the installed tree digest before returning.
# It does not run the MCP smoke; use
#   scripts/openwiki-verify-upstream.sh --release DIR --smoke
#
# Usage:
#   scripts/openwiki-install-release.sh --confirm [--source DIR] [--lock FILE]
#                                       [--home DIR] [--offline] [--activate]
#
# Env: OPENWIKI_NODE, OPENWIKI_SOURCE, OPENWIKI_LOCK (see verify script),
#      OPENWIKI_HOME (default ${XDG_DATA_HOME:-$HOME/.local/share}/ds4-openwiki)
#
# Exit: 0 installed or already present, 1 failure, 2 usage, 3 STOP.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFY="$SCRIPT_DIR/openwiki-verify-upstream.sh"

CONFIRM=0
ACTIVATE=0
OFFLINE=0
SOURCE="${OPENWIKI_SOURCE:-}"
LOCK="${OPENWIKI_LOCK:-$REPO_ROOT/docs/openwiki-integration/upstream-lock.json}"
OW_HOME="${OPENWIKI_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/ds4-openwiki}"

die() { echo "openwiki-install: FAIL: $*" >&2; exit 1; }
usage_error() { echo "openwiki-install: ERROR: $*" >&2; exit 2; }
info() { echo "openwiki-install: $*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --confirm) CONFIRM=1 ;;
    --activate) ACTIVATE=1 ;;
    --offline) OFFLINE=1 ;;
    --source) shift; SOURCE="${1:?--source requires a directory}" ;;
    --lock) shift; LOCK="${1:?--lock requires a file}" ;;
    --home) shift; OW_HOME="${1:?--home requires a directory}" ;;
    -h|--help) sed -n '2,29p' "$0" >&2; exit 0 ;;
    *) usage_error "unknown argument '$1'" ;;
  esac
  shift
done
[[ $CONFIRM -eq 1 ]] || usage_error "provisioning is opt-in: pass --confirm"
[[ $OW_HOME == /* ]] || usage_error "OPENWIKI_HOME must be absolute: $OW_HOME"

# Same Node resolution as the verify script; exported so both agree.
if [[ -z "${OPENWIKI_NODE:-}" ]]; then
  OPENWIKI_NODE="$(command -v node || true)"
fi
export OPENWIKI_NODE
if [[ -n $SOURCE ]]; then export OPENWIKI_SOURCE="$SOURCE"; fi
export OPENWIKI_LOCK="$LOCK"

rc=0
"$VERIFY" || rc=$?
[[ $rc -eq 0 ]] || { info "source verification failed (exit $rc); nothing installed"; exit "$rc"; }

NODE="$OPENWIKI_NODE"
NODE_BIN_DIR="$(dirname "$(readlink -f -- "$NODE")")"
COREPACK="$NODE_BIN_DIR/corepack"
[[ -x $COREPACK ]] || die "corepack not found next to Node: $COREPACK"

# json_field FILE KEY... ; one argument per path segment (keys may hold dots).
json_field() {
  "$NODE" -e '
    const v = process.argv.slice(2).reduce((o, k) => (o == null ? o : o[k]),
      JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")));
    if (typeof v === "string") process.stdout.write(v);
  ' "$@"
}
COMMIT="$(json_field "$LOCK" git_commit)"
VERSION="$(json_field "$LOCK" package version)"
VERSION="${VERSION:-unknown}"
PACKAGE_MANAGER="$(json_field "$LOCK" package package_manager)"
[[ -n $SOURCE ]] || SOURCE="$(json_field "$LOCK" deployment_checkout path)"
[[ $PACKAGE_MANAGER =~ ^pnpm@([0-9]+\.[0-9]+\.[0-9]+)$ ]] ||
  die "lock package_manager must be pnpm@X.Y.Z, got '$PACKAGE_MANAGER'"
PNPM_VERSION="${BASH_REMATCH[1]}"

NODE_ABI="$("$NODE" -p 'process.versions.modules')"
PLATFORM="$("$NODE" -p 'process.platform + "-" + process.arch')"
RELEASE_ID="${COMMIT}-node${NODE_ABI}-${PLATFORM}"

RELEASES="$OW_HOME/releases"
TARGET="$RELEASES/$RELEASE_ID"
info "release id $RELEASE_ID (openwiki $VERSION @ $COMMIT, node ABI $NODE_ABI, $PLATFORM)"

CURRENT="$OW_HOME/current"
# Checked before any build too, so a foreign `current` fails with no side effects.
check_current() {
  if [[ -e $CURRENT || -L $CURRENT ]]; then
    [[ -L $CURRENT ]] || die "refusing to replace non-symlink $CURRENT"
  fi
}

activate() {
  local current="$CURRENT" tmp_link previous=""
  check_current
  if [[ -L $current ]]; then
    previous="$(readlink -- "$current")"
  fi
  tmp_link="$OW_HOME/.current.tmp.$$"
  ln -s -- "releases/$RELEASE_ID" "$tmp_link"
  mv -T -- "$tmp_link" "$current"
  info "activated current -> releases/$RELEASE_ID${previous:+ (previous: $previous)}"
}

[[ $ACTIVATE -eq 0 ]] || check_current
# A symlink would make an outside tree count as "already installed".
[[ ! -L $TARGET ]] || die "refusing symlinked release path; left untouched: $TARGET"
if [[ -e $TARGET ]]; then
  info "release already present, verifying instead of overwriting: $TARGET"
  "$VERIFY" --release "$TARGET" || die "existing release does not verify; left untouched: $TARGET"
  [[ $ACTIVATE -eq 0 ]] || activate
  exit 0
fi

umask 077
mkdir -p -- "$RELEASES"
STAGING="$(mktemp -d "$RELEASES/.staging.XXXXXX")"
cleanup() { rm -rf -- "$STAGING"; }
trap cleanup EXIT

mkdir -- "$STAGING/package" "$STAGING/bin"
git -C "$SOURCE" archive --format=tar "$COMMIT" | tar -x -C "$STAGING/package"
info "exported $COMMIT via git archive"

# Pinned pnpm through corepack; a shim keeps nested `pnpm run` calls in the
# upstream scripts on the same version and Node.
printf '#!/bin/sh\nexec "%s" pnpm "$@"\n' "$COREPACK" >"$STAGING/bin/pnpm"
chmod 0755 "$STAGING/bin/pnpm"
BUILD_ENV=(
  "PATH=$STAGING/bin:$NODE_BIN_DIR:$PATH"
  "COREPACK_ENABLE_AUTO_PIN=0"
  "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
  "OPENWIKI_TELEMETRY_DISABLED=1"
  "DO_NOT_TRACK=1"
  "LANGCHAIN_TRACING_V2=false"
)
pnpm_run() { (cd "$STAGING/package" && env "${BUILD_ENV[@]}" pnpm "$@"); }

got="$(pnpm_run --version)" || die "cannot run pnpm via corepack"
[[ $got == "$PNPM_VERSION" ]] || die "pnpm $got != pinned $PNPM_VERSION"

install_args=(install --frozen-lockfile --child-concurrency=2 --network-concurrency=4)
[[ $OFFLINE -eq 0 ]] || install_args+=(--offline)
pnpm_run "${install_args[@]}" >&2 || die "pnpm install --frozen-lockfile failed"
pnpm_run run build >&2 || die "pnpm run build failed"
[[ -f $STAGING/package/dist/cli/cli.js ]] || die "build produced no dist/cli/cli.js"

"$NODE" -e '
  const [file, id, commit, version, pm, engine] = process.argv.slice(1);
  const manifest = {
    schema: "ds4-openwiki-release-manifest-v1",
    integration: "ds4-openwiki-mcp-gateway",
    releaseId: id,
    openwikiCommit: commit,
    openwikiVersion: version,
    openwikiExecutable: "dist/cli/cli.js",
    packageManager: pm,
    nodeEngine: engine,
    nodeVersion: process.versions.node,
    nodeAbi: process.versions.modules,
    platform: process.platform + "-" + process.arch,
    mcpCommand: ["mcp", "--host", "ds4-studio"],
    mcpTools: ["openwiki_search", "openwiki_read"],
    mcpProtocolVersion: null,
    schemaFingerprint: null,
    mcpSmoke: "not-run",
    telemetryDisabled: true,
  };
  require("fs").writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
' "$STAGING/manifest.json" "$RELEASE_ID" "$COMMIT" "$VERSION" \
  "$PACKAGE_MANAGER" "$(json_field "$LOCK" package node_engine)"

rm -rf -- "$STAGING/bin"
# Rename within the same filesystem; -T refuses to nest into a racing target.
mv -T -- "$STAGING" "$TARGET" || die "could not move staging into $TARGET"
trap - EXIT
info "installed $TARGET"

"$VERIFY" --release "$TARGET" || die "installed release failed verification: $TARGET"
[[ $ACTIVATE -eq 0 ]] || activate
info "OK"
