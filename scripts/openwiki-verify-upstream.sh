#!/usr/bin/env bash
# Fail-closed verification of the pinned OpenWiki upstream (WP02).
#
# Source mode (default) checks a checkout against
# docs/openwiki-integration/upstream-lock.json: Node version, exact commit,
# clean worktree, package identity, file digests and static support for
# `openwiki mcp --host ds4-studio`. Release mode checks an installed release
# produced by scripts/openwiki-install-release.sh: manifest, Node ABI,
# executable digest and full tree digest. --smoke additionally performs an
# MCP initialize + tools/list exchange against the release and rejects any
# stdout byte that is not a JSON-RPC frame.
#
# Read-only: never installs, builds, fetches or modifies the checkout.
# Diagnostics go to stderr; stdout carries only --print-tree-digest output.
#
# Usage:
#   scripts/openwiki-verify-upstream.sh [--source DIR] [--lock FILE]
#   scripts/openwiki-verify-upstream.sh --release DIR [--lock FILE] [--smoke]
#   scripts/openwiki-verify-upstream.sh --print-tree-digest DIR
#
# Env: OPENWIKI_NODE  explicit Node binary (default: `node` on PATH, conda
#                     installs refused unless set explicitly)
#      OPENWIKI_LOCK, OPENWIKI_SOURCE  defaults for --lock / --source
#      OPENWIKI_SMOKE_TIMEOUT_MS       smoke deadline (default 20000)
#
# Exit: 0 verified, 1 verification failed, 2 usage error,
#       3 STOP: pinned revision does not support `mcp --host ds4-studio`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MCP_HOST_ID="ds4-studio"
EXECUTABLE_REL="dist/cli/cli.js"
REQUIRED_TOOLS="openwiki_search openwiki_read"
MANIFEST_SCHEMA="ds4-openwiki-release-manifest-v1"

MODE=source
SOURCE="${OPENWIKI_SOURCE:-}"
LOCK="${OPENWIKI_LOCK:-$REPO_ROOT/docs/openwiki-integration/upstream-lock.json}"
RELEASE=""
SMOKE=0
DIGEST_DIR=""

die() { echo "openwiki-verify: FAIL: $*" >&2; exit 1; }
stop() { echo "openwiki-verify: STOP: $*" >&2; exit 3; }
usage_error() { echo "openwiki-verify: ERROR: $*" >&2; exit 2; }
info() { echo "openwiki-verify: $*" >&2; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) shift; SOURCE="${1:?--source requires a directory}" ;;
    --lock) shift; LOCK="${1:?--lock requires a file}" ;;
    --release) shift; MODE=release; RELEASE="${1:?--release requires a directory}" ;;
    --smoke) SMOKE=1 ;;
    --print-tree-digest) shift; MODE=digest; DIGEST_DIR="${1:?--print-tree-digest requires a directory}" ;;
    -h|--help) sed -n '2,28p' "$0" >&2; exit 0 ;;
    *) usage_error "unknown argument '$1'" ;;
  esac
  shift
done
if [[ $SMOKE -eq 1 && $MODE != release ]]; then
  usage_error "--smoke requires --release DIR"
fi

# Linux follows at most 40 links per lookup; the resolver uses the same bound.
SYMLINK_MAX_HOPS=40

# Refuses a symlink target that is empty, absolute or contains a newline.
check_link_target() {
  case "$2" in
    ''|/*) die "tree digest: symlink '$1' has an empty or absolute target '$2'" ;;
    *$'\n'*) die "tree digest: symlink '$1' target contains a newline" ;;
  esac
}

# Resolves symlink $2 (path under physical root $1) one component at a time,
# like the kernel does, without realpath: `..` is applied to the physical
# directory reached so far, every link met is expanded in place, and at most
# SYMLINK_MAX_HOPS expansions are allowed, so loops such as `self -> chain` +
# `chain -> self/..` terminate. Refuses loops, dangling or non-directory
# components, and any step above the root.
resolve_tree_symlink() {
  local root="$1" link="$2" rel="${2#"$1"/}" cur next c t hops=1 depth
  local -a pending more
  local slashes="${rel//[^\/]/}"
  depth=${#slashes}
  cur="${link%/*}"
  t="$(readlink -- "$link")" || die "tree digest: cannot read symlink '$rel'"
  IFS=/ read -r -a pending <<<"$t"
  while (( ${#pending[@]} > 0 )); do
    c="${pending[0]}"
    pending=("${pending[@]:1}")
    case "$c" in
      ''|.) ;;
      ..)
        (( depth > 0 )) || die "tree digest: symlink '$rel' resolves outside the tree"
        cur="${cur%/*}"
        depth=$((depth - 1))
        ;;
      *)
        next="$cur/$c"
        if [[ -L $next ]]; then
          (( ++hops <= SYMLINK_MAX_HOPS )) ||
            die "tree digest: symlink '$rel' is a symlink loop (more than $SYMLINK_MAX_HOPS hops)"
          t="$(readlink -- "$next")" || die "tree digest: cannot read symlink '${next#"$root"/}'"
          check_link_target "${next#"$root"/}" "$t"
          IFS=/ read -r -a more <<<"$t"
          pending=("${more[@]}" "${pending[@]}")
        elif [[ -d $next ]]; then
          cur="$next"
          depth=$((depth + 1))
        elif [[ -e $next && ${#pending[@]} -eq 0 ]]; then
          cur="$next"
        else
          die "tree digest: symlink '$rel' is dangling ('${next#"$root"/}' missing or not a directory)"
        fi
        ;;
    esac
  done
}

# Symlinks must stay inside the tree so the digest covers everything the
# release can reach. A target is refused when it is empty, absolute, contains
# a newline, or lexically climbs above the root (also keeps the digest valid
# after the staging -> release move). The lexical walk alone misses chains
# such as `y -> .` + `x -> y/..`, so each link is also resolved physically by
# resolve_tree_symlink, which is bounded and refuses loops and dangling links.
# The scan itself (find -P) never follows links.
check_tree_symlinks() {
  local root link rel target slashes depth c
  local -a parts
  root="$(cd "$1" && pwd -P)" || die "tree digest: cannot resolve '$1'"
  while IFS= read -r -d '' link; do
    rel="${link#"$root"/}"
    target="$(readlink -- "$link")" || die "tree digest: cannot read symlink '$rel'"
    check_link_target "$rel" "$target"
    slashes="${rel//[^\/]/}"
    depth=${#slashes}
    IFS=/ read -r -a parts <<<"$target"
    for c in "${parts[@]}"; do
      case "$c" in
        ''|.) ;;
        ..) depth=$((depth - 1)) ;;
        *) depth=$((depth + 1)) ;;
      esac
      (( depth >= 0 )) || die "tree digest: symlink '$rel' -> '$target' escapes the tree"
    done
    resolve_tree_symlink "$root" "$link"
  done < <(find "$root" -type l -print0)
}

# Deterministic digest of a directory tree: regular files by content, symlinks
# by raw target. Any other entry type, or a symlink leaving the tree, is
# refused so nothing can hide in or behind the tree. Each record is
# `F|L NUL path NUL sha256|target NUL`: paths cannot contain NUL, so a filename
# with newlines cannot forge or merge records.
tree_digest() {
  local dir="$1"
  [[ -d $dir ]] || die "tree digest: '$dir' is not a directory"
  if [[ -n "$(cd "$dir" && find . ! -type f ! -type l ! -type d -print -quit)" ]]; then
    die "tree digest: '$dir' contains special files"
  fi
  check_tree_symlinks "$dir"
  (
    cd "$dir"
    find . \( -type f -o -type l \) -print0 | LC_ALL=C sort -z |
      node -e '
        const crypto = require("node:crypto");
        const fs = require("node:fs");
        const { createReadStream } = require("node:fs");
        const tree = crypto.createHash("sha256");
        let pending = Buffer.alloc(0);

        async function addEntry(path) {
          const stat = fs.lstatSync(path);
          if (stat.isSymbolicLink()) {
            tree.update("L\0");
            tree.update(path);
            tree.update("\0");
            tree.update(fs.readlinkSync(path, { encoding: "buffer" }));
            tree.update("\0");
            return;
          }
          if (!stat.isFile()) throw new Error("tree changed while hashing");
          const fileHash = crypto.createHash("sha256");
          for await (const chunk of createReadStream(path)) fileHash.update(chunk);
          tree.update("F\0");
          tree.update(path);
          tree.update("\0");
          tree.update(fileHash.digest("hex"));
          tree.update("\0");
        }

        (async () => {
          for await (const chunk of process.stdin) {
            pending = Buffer.concat([pending, chunk]);
            let end;
            while ((end = pending.indexOf(0)) !== -1) {
              const path = pending.subarray(0, end);
              pending = pending.subarray(end + 1);
              await addEntry(path);
            }
          }
          if (pending.length) throw new Error("unterminated path from find");
          process.stdout.write(tree.digest("hex") + "\n");
        })().catch((error) => {
          console.error("tree digest: " + error.message);
          process.exitCode = 1;
        });
      '
  )
}

if [[ $MODE == digest ]]; then
  tree_digest "$DIGEST_DIR"
  exit 0
fi

# --- Node: resolved explicitly, checked before anything else runs on it. ---
[[ -f $LOCK ]] || die "lock file not found: $LOCK"
LOCK_TEXT="$(<"$LOCK")"
# Decimal components without leading zeros: bash arithmetic would read "08"
# as invalid octal, and a failing (( )) inside `if` is silently false.
semver_re='(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})'
engine_re='"node_engine"[[:space:]]*:[[:space:]]*">='"$semver_re"'"'
if [[ ! $LOCK_TEXT =~ $engine_re ]]; then
  die "lock has no supported node_engine of the form \">=X.Y.Z\""
fi
MIN_NODE=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}")

if [[ -n "${OPENWIKI_NODE:-}" ]]; then
  NODE="$OPENWIKI_NODE"
else
  NODE="$(command -v node || true)"
  [[ -n $NODE ]] || die "node not found; set OPENWIKI_NODE"
  case "$(readlink -f -- "$NODE")" in
    *conda*|*miniforge*|*mambaforge*)
      die "refusing implicit conda Node '$NODE'; set OPENWIKI_NODE explicitly" ;;
  esac
fi
[[ -x $NODE ]] || die "OPENWIKI_NODE is not executable: $NODE"
NODE_VERSION="$("$NODE" -p 'process.versions.node' 2>/dev/null || true)"
if [[ ! $NODE_VERSION =~ ^${semver_re}$ ]]; then
  die "cannot read Node version from '$NODE' (got '$NODE_VERSION')"
fi
NODE_PARTS=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}")
for i in 0 1 2; do
  if (( NODE_PARTS[i] > MIN_NODE[i] )); then break; fi
  if (( NODE_PARTS[i] < MIN_NODE[i] )); then
    die "Node $NODE_VERSION at '$NODE' is incompatible; requires >=${MIN_NODE[0]}.${MIN_NODE[1]}.${MIN_NODE[2]}"
  fi
done
info "node $NODE_VERSION ($NODE) satisfies >=${MIN_NODE[0]}.${MIN_NODE[1]}.${MIN_NODE[2]}"

# Prints one field of the lock; empty output means missing.
lock_field() {
  "$NODE" -e '
    const v = process.argv[2].split(".").reduce((o, k) => (o == null ? o : o[k]),
      JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")));
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") process.stdout.write(String(v));
  ' "$LOCK" "$1"
}

LOCK_COMMIT="$(lock_field git_commit)"
LOCK_ENGINE="$(lock_field package.node_engine)"
[[ $LOCK_COMMIT =~ ^[0-9a-f]{40}$ ]] || die "lock git_commit is not a full SHA-1: '$LOCK_COMMIT'"

# --- Source mode. ---
verify_source() {
  if [[ -z $SOURCE ]]; then
    SOURCE="$(lock_field deployment_checkout.path)"
    [[ -n $SOURCE ]] || die "no --source given and lock has no deployment_checkout.path"
  fi
  [[ -d $SOURCE ]] || die "source checkout not found: $SOURCE"
  info "source $SOURCE"

  local head
  head="$(git -C "$SOURCE" rev-parse --verify HEAD 2>/dev/null)" || die "not a git checkout: $SOURCE"
  [[ $head == "$LOCK_COMMIT" ]] || die "HEAD $head != pinned $LOCK_COMMIT"
  local status
  status="$(git -C "$SOURCE" status --porcelain=v1 --untracked-files=all)" ||
    die "git status failed: $SOURCE"
  if [[ -n $status ]]; then
    local allowed_paths
    allowed_paths="$("$NODE" -e '
      const lock = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      if (lock.untracked_paths !== undefined && !Array.isArray(lock.untracked_paths)) process.exit(2);
      for (const path of lock.untracked_paths || []) {
        if (typeof path !== "string" || !path || path.startsWith("/") || path.split("/").includes("..")) process.exit(2);
        console.log(path);
      }
    ' "$LOCK")" || die "lock untracked_paths must be a safe array"
    while IFS= read -r entry; do
      [[ -n $entry ]] || continue
      [[ ${entry:0:2} == '??' ]] || die "tracked changes are not permitted in pinned checkout: $entry"
      local path="${entry:3}" matched=false prefix allowed
      while IFS= read -r prefix; do
        [[ -n $prefix ]] || continue
        allowed="${prefix%/}"
        if [[ $path == "$allowed" || $path == "$allowed/"* ]]; then
          matched=true
          break
        fi
      done <<<"$allowed_paths"
      [[ $matched == true ]] || die "untracked path is not allowlisted by lock: $path"
    done <<<"$status"
    info "commit $head, only lock-allowlisted untracked paths present"
  else
    info "commit $head, worktree clean"
  fi

  "$NODE" -e '
    const [pkgPath, engine] = process.argv.slice(1);
    const p = JSON.parse(require("fs").readFileSync(pkgPath, "utf8"));
    const bad = [];
    if (p.name !== "openwiki") bad.push("name " + p.name);
    if (typeof p.version !== "string" || !p.version) bad.push("missing package version");
    if (p.license !== "MIT") bad.push("license " + p.license);
    if ((p.engines || {}).node !== engine) bad.push("engines.node " + (p.engines || {}).node + " != " + engine);
    if ((p.bin || {}).openwiki !== "./dist/cli/cli.js") bad.push("bin.openwiki " + (p.bin || {}).openwiki);
    if (bad.length) { console.error(bad.join("; ")); process.exit(1); }
  ' "$SOURCE/package.json" "$LOCK_ENGINE" || die "package.json is not a compatible OpenWiki package"
  info "OpenWiki package metadata and executable entrypoint are valid (version is informational)"

  # Static evidence that this revision serves `mcp --host ds4-studio` over
  # stdio. Any drift is a STOP for re-audit, not a guess.
  local mcp_out
  if ! mcp_out="$("$NODE" -e '
    const fs = require("fs"), path = require("path");
    const [root, hostId, tools] = process.argv.slice(1);
    const read = (f) => { try { return fs.readFileSync(path.join(root, f), "utf8"); } catch { return ""; } };
    const missing = [];
    const commands = read("src/cli/commands.ts");
    if (!commands.includes("argv[0] === \"mcp\"") || !commands.includes("parseMcpCommand(argv.slice(1))"))
      missing.push("`mcp` subcommand dispatch in src/cli/commands.ts");
    if (!commands.includes("arg === \"--host\""))
      missing.push("--host option in src/cli/commands.ts");
    const protocol = read("src/integrations/core/protocol.ts");
    const m = protocol.match(/const HOST_ID_PATTERN = \/(.+)\/([a-z]*);/);
    let accepts = false;
    try { accepts = !!m && new RegExp(m[1], m[2]).test(hostId); } catch {}
    if (!accepts) missing.push("HOST_ID_PATTERN accepting " + hostId);
    for (const t of tools.split(" "))
      if (!protocol.includes("\"" + t + "\"")) missing.push("tool " + t);
    if (!read("src/cli/integrations.ts").includes("producerActor: target?.producerActor ?? command.host"))
      missing.push("unregistered host fallback in runMcpCommand");
    if (!read("src/integrations/mcp/stdio.ts").includes("new StdioServerTransport()"))
      missing.push("stdio transport in src/integrations/mcp/stdio.ts");
    if (missing.length) { console.log(missing.join("; ")); process.exit(1); }
  ' "$SOURCE" "$MCP_HOST_ID" "$REQUIRED_TOOLS")"; then
    stop "pinned revision lacks MCP support: ${mcp_out:-unknown}"
  fi
  info "source supports 'openwiki mcp --host $MCP_HOST_ID' over stdio (static check only; run --release DIR --smoke for a live handshake)"
}

# --- Release mode. ---
verify_release() {
  [[ -d $RELEASE ]] || die "release not found: $RELEASE"
  RELEASE="$(cd "$RELEASE" && pwd -P)"
  local manifest="$RELEASE/manifest.json" package="$RELEASE/package"
  [[ -f $manifest ]] || die "missing manifest: $manifest"
  [[ -d $package ]] || die "missing package tree: $package"

  "$NODE" -e '
    const [file, schema, commit, releaseId, exe, host, tools] = process.argv.slice(1);
    const m = JSON.parse(require("fs").readFileSync(file, "utf8"));
    const bad = [];
    const eq = (k, v) => { if (m[k] !== v) bad.push(k + " " + JSON.stringify(m[k]) + " != " + JSON.stringify(v)); };
    eq("schema", schema);
    eq("openwikiCommit", commit);
    eq("releaseId", releaseId);
    eq("openwikiExecutable", exe);
    eq("nodeAbi", process.versions.modules);
    eq("platform", process.platform + "-" + process.arch);
    eq("telemetryDisabled", true);
    if (JSON.stringify(m.mcpCommand) !== JSON.stringify(["mcp", "--host", host])) bad.push("mcpCommand");
    if (JSON.stringify(m.mcpTools) !== JSON.stringify(tools.split(" "))) bad.push("mcpTools");
    if (bad.length) { console.error(bad.join("; ")); process.exit(1); }
  ' "$manifest" "$MANIFEST_SCHEMA" "$LOCK_COMMIT" "$(basename "$RELEASE")" \
    "$EXECUTABLE_REL" "$MCP_HOST_ID" "$REQUIRED_TOOLS" ||
    die "manifest does not match the source commit or this Node runtime (ABI/platform)"

  [[ -f $package/$EXECUTABLE_REL && ! -L $package/$EXECUTABLE_REL ]] ||
    die "executable missing or a symlink: $EXECUTABLE_REL"
  info "release $RELEASE matches manifest (commit $LOCK_COMMIT; version and SHA checks disabled)"
}

# Live MCP exchange in an isolated HOME with telemetry disabled. Only proves
# handshake/listTools and stdout hygiene; it does not prove zero egress.
smoke_release() {
  local tmp rc=0
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/openwiki-smoke.XXXXXX")"
  SMOKE_NODE="$NODE" SMOKE_EXE="$RELEASE/package/$EXECUTABLE_REL" SMOKE_HOST="$MCP_HOST_ID" \
    SMOKE_TOOLS="$REQUIRED_TOOLS" SMOKE_TMP="$tmp" SMOKE_TIMEOUT_MS="${OPENWIKI_SMOKE_TIMEOUT_MS:-20000}" \
    "$NODE" - <<'JS' || rc=$?
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  SMOKE_NODE: node, SMOKE_EXE: exe, SMOKE_HOST: host,
  SMOKE_TOOLS: toolList, SMOKE_TMP: tmp, SMOKE_TIMEOUT_MS: timeoutMs,
} = process.env;
for (const d of ["home", "config", "data", "cache", "cwd"]) fs.mkdirSync(path.join(tmp, d));
const env = {
  PATH: path.dirname(node) + ":/usr/bin:/bin",
  HOME: path.join(tmp, "home"),
  XDG_CONFIG_HOME: path.join(tmp, "config"),
  XDG_DATA_HOME: path.join(tmp, "data"),
  XDG_CACHE_HOME: path.join(tmp, "cache"),
  OPENWIKI_TELEMETRY_DISABLED: "1",
  DO_NOT_TRACK: "1",
  LANGCHAIN_TRACING_V2: "false",
  NODE_ENV: "production",
};
const child = spawn(node, [exe, "mcp", "--host", host], {
  cwd: path.join(tmp, "cwd"), env, stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (d) => { if (stderr.length < 8192) stderr += d; });
let done = false;
let handshakeComplete = false;
const finish = (code, msg) => {
  if (done) return;
  done = true;
  console.error((code ? "smoke FAIL: " : "smoke: ") + msg);
  if (code && stderr) console.error("child stderr:\n" + stderr.slice(0, 8192));
  child.stdin.end();
  if (child.exitCode !== null || child.signalCode !== null) process.exit(code);
  const killer = setTimeout(() => child.kill("SIGKILL"), 2000);
  child.once("exit", () => { clearTimeout(killer); process.exit(code); });
  child.kill("SIGTERM");
};
setTimeout(() => finish(1, "timeout after " + timeoutMs + " ms"), Number(timeoutMs)).unref();
child.on("error", (e) => finish(1, "spawn error: " + e.message));
child.on("close", (c, s) => {
  if (handshakeComplete && c === 0 && s === null) {
    return finish(0, "handshake ok, protocolVersion " + protocolVersion + ", tools listed");
  }
  finish(1, "server exited early (code " + c + ", signal " + s +
    ", protocol " + (protocolVersion ?? "none") + ", pending stdout " + JSON.stringify(buf.slice(0, 200)) + ")");
});
child.once("spawn", () => send({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ds4-openwiki-verify", version: "1" } },
}));
const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
let buf = "";
let protocolVersion = null;
child.stdout.on("data", (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    let msg;
    try { msg = JSON.parse(line); } catch { msg = null; }
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0")
      return finish(1, "stdout contamination: non JSON-RPC line " + JSON.stringify(line.slice(0, 200)));
    if (msg.id === 1) {
      if (msg.error || !msg.result || typeof msg.result.protocolVersion !== "string")
        return finish(1, "initialize failed: " + JSON.stringify(msg.error || msg.result));
      protocolVersion = msg.result.protocolVersion;
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    } else if (msg.id === 2) {
      if (msg.error || !Array.isArray(msg.result?.tools))
        return finish(1, "tools/list failed: " + JSON.stringify(msg.error || msg.result));
      const names = msg.result.tools.map((t) => t.name);
      const missing = toolList.split(" ").filter((t) => !names.includes(t));
      if (missing.length) return finish(1, "missing tools: " + missing.join(", "));
      handshakeComplete = true;
      // Let any trailing stdout bytes surface before declaring it clean.
      setTimeout(() => {
        if (buf.length) return finish(1, "stdout contamination: trailing bytes " + JSON.stringify(buf.slice(0, 200)));
        finish(0, "handshake ok, protocolVersion " + protocolVersion + ", tools " + names.join(","));
      }, 200);
    }
  }
});
JS
  rm -rf -- "$tmp"
  [[ $rc -eq 0 ]] || die "MCP smoke failed"
}

case "$MODE" in
  source) verify_source ;;
  release)
    verify_release
    if [[ $SMOKE -eq 1 ]]; then smoke_release; fi
    ;;
esac
info "OK"
