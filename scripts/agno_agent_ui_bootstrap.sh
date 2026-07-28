#!/usr/bin/env bash
# Reproducible bootstrap for the vendored Agno Agent UI, per DS4 plan Fase 4 (SS9).
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOCK_FILE="$ROOT_DIR/third_party/agno-agent-ui/upstream.lock"
RUNTIME_DIR="${DS4_AGNO_AGENT_UI_RUNTIME_DIR:-$ROOT_DIR/.runtime/agno-agent-ui}"
READY_FILE="$RUNTIME_DIR/.ds4-ready"

die() {
  echo "agno-agent-ui-bootstrap: $*" >&2
  exit 1
}

[[ -f "$LOCK_FILE" ]] || die "missing lock file: $LOCK_FILE"

while IFS='=' read -r key value; do
  [[ -z "$key" ]] && continue
  [[ "$key" =~ ^[A-Z0-9_]+$ ]] || die "invalid lock key: $key"
  [[ "$value" =~ [\`\$\(] ]] && die "unsafe lock value for $key"
  case "$key" in
    AGNO_AGENT_UI_REPOSITORY) REPOSITORY="$value" ;;
    AGNO_AGENT_UI_COMMIT) COMMIT="$value" ;;
    AGNO_AGENT_UI_PNPM_VERSION) PNPM_VERSION="$value" ;;
    AGNO_AGENT_UI_PACKAGE_VERSION) PACKAGE_VERSION="$value" ;;
    AGNO_AGENT_UI_NEXT_VERSION) NEXT_VERSION="$value" ;;
  esac
done < "$LOCK_FILE"

[[ "${REPOSITORY:-}" == "agno-agi/agent-ui" ]] ||
  die "unexpected repository"
[[ "${COMMIT:-}" =~ ^[0-9a-f]{40}$ ]] ||
  die "invalid commit"
[[ "${PNPM_VERSION:-}" == "10.14.0" ]] ||
  die "unexpected pnpm version"

command -v git >/dev/null || die "git not found"
command -v node >/dev/null || die "node not found"
command -v corepack >/dev/null || die "corepack not found"

# Overridable so the offline test fixture (tests/test_srun_agno_agent_ui_bootstrap.sh)
# can point at a local repo instead of GitHub; defaults to the real upstream.
REMOTE_URL="${DS4_AGNO_AGENT_UI_REMOTE_URL:-https://github.com/${REPOSITORY}.git}"

mkdir -p "$(dirname "$RUNTIME_DIR")"

JUST_CLONED=0
if [[ ! -d "$RUNTIME_DIR/.git" ]]; then
  [[ ! -e "$RUNTIME_DIR" || -z "$(ls -A "$RUNTIME_DIR" 2>/dev/null)" ]] ||
    die "runtime dir exists and is not an empty git checkout: $RUNTIME_DIR"

  rm -rf "$RUNTIME_DIR"
  git clone --filter=blob:none --no-checkout \
    "$REMOTE_URL" \
    "$RUNTIME_DIR"
  JUST_CLONED=1
fi

ORIGIN="$(git -C "$RUNTIME_DIR" remote get-url origin)"
case "$ORIGIN" in
  "$REMOTE_URL"|"git@github.com:${REPOSITORY}.git")
    ;;
  *)
    die "unexpected origin: $ORIGIN"
    ;;
esac

# A fresh --no-checkout clone stages HEAD's tree in the index while leaving
# the working tree empty, so status --porcelain reports every file as a
# staged deletion. That is not real dirt — only check on subsequent runs.
# The ready marker itself is excluded via pathspec: it is our own artifact,
# written inside the checkout (per agnoUiConfig.mjs contract), not upstream dirt.
if [[ "$JUST_CLONED" -eq 0 ]] &&
   [[ -n "$(git -C "$RUNTIME_DIR" status --porcelain -- . ':!.ds4-ready')" ]]; then
  die "upstream worktree is dirty; refusing destructive checkout"
fi

git -C "$RUNTIME_DIR" fetch --depth 1 origin "$COMMIT"
git -C "$RUNTIME_DIR" checkout --detach "$COMMIT"

ACTUAL_COMMIT="$(git -C "$RUNTIME_DIR" rev-parse HEAD)"
[[ "$ACTUAL_COMMIT" == "$COMMIT" ]] ||
  die "checkout mismatch: $ACTUAL_COMMIT"

corepack prepare "pnpm@${PNPM_VERSION}" --activate

(
  cd "$RUNTIME_DIR"
  NEXT_TELEMETRY_DISABLED=1 pnpm install --no-frozen-lockfile --ignore-scripts
  NEXT_TELEMETRY_DISABLED=1 pnpm build
)

[[ -f "$RUNTIME_DIR/.next/BUILD_ID" ]] ||
  die "Next.js build marker missing"

ACTUAL_PACKAGE_VERSION="$(
  node -e 'const p=require(process.argv[1]); process.stdout.write(String(p.version))' \
    "$RUNTIME_DIR/package.json"
)"
[[ "$ACTUAL_PACKAGE_VERSION" == "$PACKAGE_VERSION" ]] ||
  die "package version mismatch"

ACTUAL_NEXT_VERSION="$(
  node -e 'const p=require(process.argv[1]); process.stdout.write(String(p.dependencies.next))' \
    "$RUNTIME_DIR/package.json"
)"
[[ "$ACTUAL_NEXT_VERSION" == "$NEXT_VERSION" ]] ||
  die "Next.js version mismatch"

TMP_READY="${READY_FILE}.tmp.$$"
{
  echo "repository=$REPOSITORY"
  echo "commit=$COMMIT"
  echo "pnpm=$PNPM_VERSION"
  echo "package=$PACKAGE_VERSION"
  echo "next=$NEXT_VERSION"
  echo "build_id=$(cat "$RUNTIME_DIR/.next/BUILD_ID")"
} > "$TMP_READY"

chmod 0644 "$TMP_READY"
mv "$TMP_READY" "$READY_FILE"

echo "agno-agent-ui-bootstrap: ready"
echo "  runtime: $RUNTIME_DIR"
echo "  commit:  $COMMIT"
