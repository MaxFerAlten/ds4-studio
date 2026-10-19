#!/usr/bin/env bash
# Read-only fingerprint of a DS4 checkout (plan §3.3, §38.3).
#
#   audit-upstream.sh --root <DS4_ROOT> --output <file.json>
#   audit-upstream.sh --root <DS4_ROOT> --compare <before.json> [--output <after.json>]
#
# Never writes inside DS4_ROOT. Output must live outside the checkout.
# Exit codes: 0 identical/ok, 2 bad args, 7 integrity difference.
set -euo pipefail
umask 077

ROOT=""
OUT=""
CMP=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    --output) OUT="$2"; shift 2 ;;
    --compare) CMP="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
ROOT="${ROOT:-${DS4_ROOT:-}}"
[[ -n "$ROOT" ]] || { echo "--root or DS4_ROOT required" >&2; exit 2; }
[[ -d "$ROOT/.git" || -f "$ROOT/.git" ]] || { echo "not a git checkout: $ROOT" >&2; exit 2; }
ROOT="$(realpath "$ROOT")"
if [[ -n "$OUT" ]]; then
  OUT_DIR="$(realpath -m "$(dirname "$OUT")")"
  case "$OUT_DIR/" in "$ROOT"/*) echo "refusing to write report inside DS4 root" >&2; exit 2 ;; esac
fi

exec python3 - "$ROOT" "$OUT" "$CMP" <<'PY'
import hashlib, json, os, stat, subprocess, sys, datetime

root, out, cmp_path = sys.argv[1], sys.argv[2], sys.argv[3]

def git(*args: str) -> bytes:
    # GIT_OPTIONAL_LOCKS=0: `git status` must not refresh/write .git/index.
    env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
    return subprocess.run(['git', '-C', root, *args], check=True,
                          capture_output=True, env=env).stdout

def file_digest(rel: str) -> dict:
    p = os.path.join(root, rel)
    try:
        st = os.lstat(p)
    except FileNotFoundError:
        return {'kind': 'missing'}
    if stat.S_ISLNK(st.st_mode):
        # Never follow links out of the root: hash the link text itself.
        return {'kind': 'symlink', 'target_sha256': hashlib.sha256(os.readlink(p).encode()).hexdigest()}
    if stat.S_ISDIR(st.st_mode):
        return {'kind': 'dir'}  # gitlink / submodule
    h = hashlib.sha256()
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return {'kind': 'file', 'sha256': h.hexdigest(), 'size': st.st_size,
            'mode': oct(stat.S_IMODE(st.st_mode))}

head = git('rev-parse', 'HEAD').decode().strip()
stage = git('ls-files', '-s', '-z').split(b'\0')
tracked = {}
for row in stage:
    if not row:
        continue
    meta, path = row.split(b'\t', 1)
    mode, blob, _ = meta.decode().split()
    rel = path.decode('utf-8', 'surrogateescape')
    tracked[rel] = {'index_mode': mode, 'index_blob': blob, **file_digest(rel)}

status = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split(b'\0')
status_rows = sorted(s.decode('utf-8', 'surrogateescape') for s in status if s)
untracked = {}
for row in status_rows:
    if row.startswith('?? '):
        rel = row[3:]
        try:
            st = os.lstat(os.path.join(root, rel))
            # Untracked manifest records size+mtime only (may include large/user data).
            untracked[rel] = {'size': st.st_size, 'mtime_ns': st.st_mtime_ns}
        except FileNotFoundError:
            untracked[rel] = {'kind': 'missing'}

tracked_blob = json.dumps(tracked, sort_keys=True, separators=(',', ':')).encode()
report = {
    'schema_version': 1,
    'root': root,
    'head': head,
    'captured_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'tracked_count': len(tracked),
    'tracked_manifest_sha256': hashlib.sha256(tracked_blob).hexdigest(),
    'status_porcelain': status_rows,
    'untracked': untracked,
    'tracked': tracked,
}

rc = 0
if cmp_path:
    with open(cmp_path, encoding='utf-8') as f:
        before = json.load(f)
    diffs = []
    if before['root'] != root:
        diffs.append({'field': 'root', 'before': before['root'], 'after': root})
    if before['head'] != head:
        diffs.append({'field': 'head', 'before': before['head'], 'after': head})
    for rel in sorted(set(before['tracked']) | set(tracked)):
        if before['tracked'].get(rel) != tracked.get(rel):
            diffs.append({'field': 'tracked', 'path': rel})
    for rel in sorted(set(before['untracked']) | set(untracked)):
        if before['untracked'].get(rel) != untracked.get(rel):
            diffs.append({'field': 'untracked', 'path': rel})
    report['compare'] = {'against': os.path.abspath(cmp_path), 'identical': not diffs,
                         'differences': diffs}
    summary = {'identical': not diffs, 'differences': len(diffs), 'head': head,
               'tracked_manifest_sha256': report['tracked_manifest_sha256']}
    if diffs:
        summary['first'] = diffs[:20]
        rc = 7
    print(json.dumps(summary, indent=2))
else:
    print(json.dumps({'head': head, 'tracked_count': len(tracked),
                      'tracked_manifest_sha256': report['tracked_manifest_sha256'],
                      'status_entries': len(status_rows)}, indent=2))

if out:
    tmp = out + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=1, sort_keys=True)
        f.flush(); os.fsync(f.fileno())
    os.replace(tmp, out)
sys.exit(rc)
PY
