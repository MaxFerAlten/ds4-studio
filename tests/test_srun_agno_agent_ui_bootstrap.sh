#!/usr/bin/env bash
# Offline fixture test for scripts/agno_agent_ui_bootstrap.sh per plan Fase 4 (SS9.3).
# Never clones GitHub: uses a local git fixture repo as the upstream origin
# (DS4_AGNO_AGENT_UI_REMOTE_URL override) and fake pnpm/corepack binaries.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/agno_agent_ui_bootstrap.sh"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

export GIT_AUTHOR_NAME=ds4-test GIT_AUTHOR_EMAIL=ds4-test@example.invalid
export GIT_COMMITTER_NAME=ds4-test GIT_COMMITTER_EMAIL=ds4-test@example.invalid

FAKE_BIN="$WORKDIR/fake-bin"
mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/corepack" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$FAKE_BIN/corepack"

# write_fake_pnpm MODE — MODE=yes writes .next/BUILD_ID on build, MODE=no skips it
# (used to simulate a broken upstream build for the missing-marker scenario).
write_fake_pnpm() {
  local mode="$1"
  cat > "$FAKE_BIN/pnpm" <<EOF
#!/usr/bin/env bash
case "\$1" in
  build)
    if [[ "$mode" == "yes" ]]; then
      mkdir -p .next
      echo fake-build-id > .next/BUILD_ID
    fi
    ;;
esac
exit 0
EOF
  chmod +x "$FAKE_BIN/pnpm"
}

export PATH="$FAKE_BIN:$PATH"

# make_fixture_repo DIR PKG_VERSION NEXT_VERSION — local git repo standing in
# for the upstream GitHub repo; echoes its HEAD commit sha.
make_fixture_repo() {
  local dir="$1" pkg_version="$2" next_version="$3"
  rm -rf "$dir"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" config user.email ds4-test@example.invalid
  git -C "$dir" config user.name ds4-test
  printf 'node_modules\n.next\n' > "$dir/.gitignore"
  cat > "$dir/package.json" <<EOF
{"name": "agent-ui", "version": "$pkg_version", "dependencies": {"next": "$next_version"}}
EOF
  echo fixture-lockfile > "$dir/pnpm-lock.yaml"
  git -C "$dir" add -A
  git -C "$dir" commit -q -m fixture
  git -C "$dir" rev-parse HEAD
}

write_lock() {
  local path="$1" commit="$2" pkg_version="$3" next_version="$4"
  cat > "$path" <<EOF
AGNO_AGENT_UI_REPOSITORY=agno-agi/agent-ui
AGNO_AGENT_UI_COMMIT=$commit
AGNO_AGENT_UI_PNPM_VERSION=10.14.0
AGNO_AGENT_UI_PACKAGE_VERSION=$pkg_version
AGNO_AGENT_UI_NEXT_VERSION=$next_version
EOF
}

run_bootstrap() {
  local root_dir="$1"
  DS4_AGNO_AGENT_UI_REMOTE_URL="$FIXTURE_ORIGIN" "$SCRIPT" "$root_dir"
}

FIXTURE_ORIGIN="$WORKDIR/fixture-origin"
FIXTURE_COMMIT="$(make_fixture_repo "$FIXTURE_ORIGIN" 0.1.0 15.5.18)"
write_fake_pnpm yes

echo "[1/10] first install"
SCEN1="$WORKDIR/scen1"
mkdir -p "$SCEN1/third_party/agno-agent-ui"
write_lock "$SCEN1/third_party/agno-agent-ui/upstream.lock" "$FIXTURE_COMMIT" 0.1.0 15.5.18
run_bootstrap "$SCEN1" || { echo "FAIL: first install failed"; exit 1; }
[[ -f "$SCEN1/.runtime/agno-agent-ui/.ds4-ready" ]] || { echo "FAIL: ready marker missing after first install"; exit 1; }

echo "[2/10] idempotent rerun"
run_bootstrap "$SCEN1" || { echo "FAIL: idempotent rerun failed"; exit 1; }
[[ -f "$SCEN1/.runtime/agno-agent-ui/.ds4-ready" ]] || { echo "FAIL: ready marker missing after rerun"; exit 1; }

echo "[3/10] unexpected origin rejected"
git -C "$SCEN1/.runtime/agno-agent-ui" remote set-url origin "$WORKDIR/some-other-repo"
run_bootstrap "$SCEN1" && { echo "FAIL: unexpected origin accepted"; exit 1; }
git -C "$SCEN1/.runtime/agno-agent-ui" remote set-url origin "$FIXTURE_ORIGIN"

echo "[4/10] dirty worktree rejected"
echo dirty >> "$SCEN1/.runtime/agno-agent-ui/package.json"
run_bootstrap "$SCEN1" && { echo "FAIL: dirty worktree accepted"; exit 1; }

echo "[5/10] invalid commit rejected"
SCEN5="$WORKDIR/scen5"
mkdir -p "$SCEN5/third_party/agno-agent-ui"
write_lock "$SCEN5/third_party/agno-agent-ui/upstream.lock" "not-a-valid-commit" 0.1.0 15.5.18
run_bootstrap "$SCEN5" && { echo "FAIL: invalid commit accepted"; exit 1; }

echo "[6/10] lock with command substitution rejected"
SCEN6="$WORKDIR/scen6"
mkdir -p "$SCEN6/third_party/agno-agent-ui"
write_lock "$SCEN6/third_party/agno-agent-ui/upstream.lock" "$FIXTURE_COMMIT" 0.1.0 15.5.18
echo 'AGNO_AGENT_UI_EXTRA=$(whoami)' >> "$SCEN6/third_party/agno-agent-ui/upstream.lock"
run_bootstrap "$SCEN6" && { echo "FAIL: command substitution accepted"; exit 1; }

echo "[7/10] missing build marker rejected"
SCEN7="$WORKDIR/scen7"
mkdir -p "$SCEN7/third_party/agno-agent-ui"
write_lock "$SCEN7/third_party/agno-agent-ui/upstream.lock" "$FIXTURE_COMMIT" 0.1.0 15.5.18
write_fake_pnpm no
run_bootstrap "$SCEN7" && { echo "FAIL: missing build marker accepted"; exit 1; }
write_fake_pnpm yes

echo "[8/10] package version mismatch rejected"
SCEN8="$WORKDIR/scen8"
mkdir -p "$SCEN8/third_party/agno-agent-ui"
write_lock "$SCEN8/third_party/agno-agent-ui/upstream.lock" "$FIXTURE_COMMIT" 9.9.9 15.5.18
run_bootstrap "$SCEN8" && { echo "FAIL: package version mismatch accepted"; exit 1; }

echo "[9/10] Next.js version mismatch rejected"
SCEN9="$WORKDIR/scen9"
mkdir -p "$SCEN9/third_party/agno-agent-ui"
write_lock "$SCEN9/third_party/agno-agent-ui/upstream.lock" "$FIXTURE_COMMIT" 0.1.0 9.9.9
run_bootstrap "$SCEN9" && { echo "FAIL: Next version mismatch accepted"; exit 1; }

echo "[10/10] ready marker written atomically"
SCEN10="$WORKDIR/scen10"
mkdir -p "$SCEN10/third_party/agno-agent-ui"
write_lock "$SCEN10/third_party/agno-agent-ui/upstream.lock" "$FIXTURE_COMMIT" 0.1.0 15.5.18
run_bootstrap "$SCEN10" || { echo "FAIL: run for ready-marker check failed"; exit 1; }
READY="$SCEN10/.runtime/agno-agent-ui/.ds4-ready"
[[ -f "$READY" ]] || { echo "FAIL: ready marker not written"; exit 1; }
grep -q "^commit=$FIXTURE_COMMIT\$" "$READY" || { echo "FAIL: ready marker missing commit field"; exit 1; }
if find "$SCEN10/.runtime/agno-agent-ui" -maxdepth 1 -name '.ds4-ready.tmp.*' | grep -q .; then
  echo "FAIL: leftover temp ready file"; exit 1
fi

echo "agno-agent-ui bootstrap certification: PASS"
