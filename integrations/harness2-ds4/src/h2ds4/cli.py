"""h2ds4 command line (plan §29). No command patches, edits, restarts or launches DS4.

Exit codes: 0 ok, 2 invalid arguments, 3 capability missing, 4 policy blocked,
5 resource busy, 6 experiment failed, 7 integrity failure, 10 internal error.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import shutil
import sys
import tempfile
import uuid
from pathlib import Path

from . import __version__
from .errors import Code, Exit, H2DS4Error
from .settings import PolicyError, Settings, load

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / 'fixtures'


def _out(obj: object, as_json: bool = True) -> None:
    if as_json:
        print(json.dumps(obj, indent=2, sort_keys=True, default=str))
    else:
        print(obj)


def _settings(args: argparse.Namespace) -> Settings:
    return load(Path(args.config).resolve() if args.config else None)


def _client(s: Settings, admin: bool = False):
    from .client import SidecarClient
    token = None
    if admin:
        p = s.data_dir / 'admin.token'
        try:
            token = p.read_text(encoding='utf-8').strip()
        except OSError as e:
            raise H2DS4Error(Code.UNAUTHORIZED, 'admin token unreadable') from e
    return SidecarClient(s.uds_path, admin_token=token)


def _local(s: Settings):
    """Direct store access for registry/audit commands; holds the data-dir lock."""
    from .serve import acquire_lock, prepare_dirs
    from .store.blobs import BlobStore
    from .store.sqlite import SqliteStore
    prepare_dirs(s)
    lock = acquire_lock(s.data_dir)
    return SqliteStore(s.db_path).initialize(), BlobStore(s.data_dir / 'blob'), lock


# -- commands ------------------------------------------------------------------------------

def cmd_preflight(args, s: Settings | None) -> int:
    from .policy.paths import is_within
    from .sandbox.bwrap import preflight as sbp
    from .upstream import discover, fingerprint
    root = Path(args.ds4_root)
    out = Path(args.output).resolve() if args.output else None
    if out is not None and is_within(out.parent, root):
        raise H2DS4Error(Code.POLICY_DENIED, 'report may not be written inside DS4')
    report = {'discovery': discover(root), 'fingerprint': fingerprint(root),
              'sandbox': sbp(), 'python': sys.version.split()[0]}
    if out is not None:
        out.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    _out(report)
    return 0


def cmd_doctor(args, s: Settings | None) -> int:
    from .evidence.fingerprint import H2_COMMIT
    from .sandbox.bwrap import preflight as sbp
    checks: dict[str, object] = {'version': __version__, 'python': sys.version.split()[0]}
    try:
        import harness2
        checks['harness2_import'] = True
        vendor = REPO / 'vendor' / 'harness2' / '.git'
        if vendor.exists():
            head = os.popen(f'git -C {REPO / "vendor" / "harness2"} rev-parse HEAD').read().strip()
            checks['harness2_vendor_commit'] = head
            checks['harness2_pinned'] = head == H2_COMMIT
        checks['harness2_version'] = getattr(harness2, '__version__', 'unknown')
    except ImportError:
        checks['harness2_import'] = False
    try:
        s = s or _settings(args)
        checks['config'] = 'valid'
        checks['mode'] = str(s.service.mode)
        checks['enabled'] = s.service.enabled
        checks['socket_present'] = s.uds_path.is_socket()
        checks['model_id_configured'] = bool(s.ds4.model_id)
    except (PolicyError, H2DS4Error) as e:
        checks['config'] = f'invalid: {e}'
    checks['sandbox'] = sbp()
    checks['opencode'] = shutil.which('opencode') is not None
    _out(checks)
    ok = checks.get('config') == 'valid' and checks.get('harness2_import') and \
        checks['sandbox']['ok']  # type: ignore[index]
    return 0 if ok else int(Exit.CAPABILITY_MISSING)


def cmd_capability(args, s: Settings) -> int:
    from .service import Service
    if s.uds_path.is_socket():
        _out(_client(s).get('/v1/capabilities'))
    else:
        _out(Service(s, None, None, FIXTURES).capabilities())  # type: ignore[arg-type]
    return 0


def cmd_register(args, s: Settings) -> int:
    from . import registry as R
    from .fixtures import list_fixtures
    store, blobs, lock = _local(s)
    try:
        ids = list_fixtures(FIXTURES) if args.all else args.ids
        out = {'fixtures': [R.register_fixture(store, FIXTURES, t) for t in ids],
               'base_harness_id': R.register_harness(store, blobs, R.load_base_harness()),
               'scripted_profile_id': R.register_profile(store, R.SCRIPTED_PROFILE)}
        if args.model_profile:
            from .models import ModelProfile
            prof = ModelProfile(**json.loads(Path(args.model_profile).read_text()))
            out['model_profile_id'] = R.register_profile(store, prof)
    finally:
        os.close(lock)
    _out(out)
    return 0


def cmd_experiment(args, s: Settings) -> int:
    c = _client(s)
    if args.action == 'create':
        spec = json.loads(Path(args.spec).read_text(encoding='utf-8'))
        _out(c.post('/v1/experiments', spec, idem=args.idempotency_key or str(uuid.uuid4())))
    elif args.action == 'run':
        if not args.maintenance_window:
            raise H2DS4Error(Code.POLICY_DENIED, '--maintenance-window is required: confirm no '
                             'DS4 chat/agent session is active')
        from .service import MAINTENANCE_ACK
        _out(c.post(f'/v1/experiments/{args.id}/run', {'maintenance_ack': MAINTENANCE_ACK},
                    idem=args.idempotency_key or f'run-{args.id}'))
    elif args.action == 'status':
        _out(c.get(f'/v1/experiments/{args.id}'))
    elif args.action == 'list':
        _out(c.get('/v1/experiments'))
    elif args.action == 'cancel':
        _out(c.post(f'/v1/experiments/{args.id}/cancel'))
    elif args.action == 'report':
        exp = c.get(f'/v1/experiments/{args.id}')
        ev = c.get(f'/v1/experiments/{args.id}/evidence')
        md = render_report(exp, ev)
        if args.output:
            Path(args.output).write_text(md, encoding='utf-8')
        print(md)
        if exp['state'] == 'FAILED':
            return int(Exit.EXPERIMENT_FAILED)
    return 0


def render_report(exp: dict, ev: dict) -> str:
    lines = [f"# h2ds4 experiment {exp['id']}", '',
             f"- task: `{exp['task_id']}`  substrate: `{exp['substrate']}`  k={exp['k']}",
             f"- state: **{exp['state']}**  error: `{exp.get('error_code')}`",
             f"- decision: **{ev.get('decision')}** — {ev.get('reason')}", '',
             '| run | status | tool calls | tokens in/out (source) | ms |', '|---|---|---:|---|---:|']
    for r in exp['runs']:
        lines.append(f"| {r['label']} | {r['status']} | {r['tool_calls']} | "
                     f"{r['token_in']}/{r['token_out']} ({r['usage_source']}) | {r['duration_ms']} |")
    lines += ['', '| eval | verdict | success | quality | hard fail | security |',
              '|---|---|---:|---:|---:|---:|']
    for e in ev.get('evaluations', []):
        m = e['metrics']
        lines.append(f"| {e['label']} | {e['verdict']} | {m['success']} | {m['quality']:.3f} | "
                     f"{m['hard_failures']} | {m['security_violations']} |")
    if ev.get('ledger'):
        lg = ev['ledger']
        lines += ['', f"Ledger: R={lg['R']} (expected {lg['expected_R']}), "
                      f"P={lg['P']} (expected {lg['expected_P']}). USD fields are not a cost "
                      f"measure for a local model."]
    return '\n'.join(lines) + '\n'


def cmd_overlay(args, s: Settings) -> int:
    from .canonical import is_digest
    if args.action == 'status':
        _out(_client(s).get('/v1/overlays') if s.uds_path.is_socket() else _overlay_local(s))
    elif args.action == 'diff':
        from .overlay.stage import load_overlay
        from .registry import load_base_harness
        st = _overlay_local(s)
        ov = next((o for o in st['overlays'] if o['id'] == args.id), None)
        if ov is None or not is_digest(ov['digest']):
            raise H2DS4Error(Code.NOT_FOUND, 'overlay not found')
        tree, _m = load_overlay(s.data_dir, ov['digest'])
        base = load_base_harness()
        for p in sorted(set(tree) | set(base)):
            a = base.get(p, b'').decode().splitlines(True)
            b = tree.get(p, b'').decode().splitlines(True)
            sys.stdout.writelines(difflib.unified_diff(a, b, f'base/{p}', f'overlay/{p}'))
    elif args.action == 'validate':
        res = _client(s, admin=True).post(f'/v1/overlays/{args.id}/validate', admin=True)
        _out(res)
        if not res.get('passed'):
            return int(Exit.POLICY_BLOCKED)
    elif args.action == 'approve':
        c = _client(s, admin=True)
        st = c.get('/v1/overlays')
        expected = args.expected_active or st['active_digest']
        _out(c.post(f'/v1/overlays/{args.id}/approve',
                    {'expected_active_digest': expected, 'reason': args.reason}, admin=True))
    elif args.action == 'activate':
        c = _client(s, admin=True)
        rev = args.expected_revision if args.expected_revision is not None \
            else c.get('/v1/overlays')['revision']
        _out(c.post(f'/v1/overlays/{args.id}/activate',
                    {'expected_revision': rev, 'reason': args.reason}, admin=True))
    elif args.action == 'rollback':
        _out(_client(s, admin=True).post('/v1/overlays/rollback', {
            'expected_revision': args.expected_revision, 'reason': args.reason}, admin=True))
    elif args.action == 'export-skills':
        from .overlay.export import export_skills
        from .overlay.stage import load_overlay
        st = _overlay_local(s)
        ov = next((o for o in st['overlays'] if o['id'] == args.id), None)
        if ov is None or ov['state'] != 'APPROVED':
            raise H2DS4Error(Code.POLICY_DENIED, 'only APPROVED overlays can be exported')
        tree, _m = load_overlay(s.data_dir, ov['digest'])
        ds4 = Path(s.ds4.root)
        dest = Path(args.destination).resolve() if args.destination else \
            s.data_dir / 'staged-skills'
        res = export_skills(canonical_dir=ds4 / 'skills', overlay_tree=tree, staging_root=dest,
                            protected_roots=[ds4, *(Path(p) for p in s.ds4.protected_roots)],
                            replace=frozenset(args.replace or ()), srun_path=ds4 / 'srun.sh')
        _out(res)
    return 0


def _overlay_local(s: Settings) -> dict:
    from .overlay.approve import OverlayService
    from .store.sqlite import SqliteStore
    store = SqliteStore(s.db_path)
    if not s.db_path.exists():
        raise H2DS4Error(Code.NOT_FOUND, 'no state database yet')
    return OverlayService(store, s.data_dir).status()


def cmd_audit(args, s: Settings) -> int:
    from .store.sqlite import SqliteStore
    if not s.db_path.exists():
        raise H2DS4Error(Code.NOT_FOUND, 'no state database yet')
    res = SqliteStore(s.db_path).verify_audit()
    _out(res)
    return 0 if res['ok'] else int(Exit.INTEGRITY_FAILURE)


def cmd_serve(args, s: Settings) -> int:
    from .serve import serve
    serve(s, recover_stale=args.recover_stale)
    return 0


def cmd_demo(args, s: Settings | None) -> int:
    """Run one fixture end to end in a throwaway state dir, scripted substrate, no model."""
    from .lab import run_lab
    if not args.no_model:
        raise H2DS4Error(Code.CAPABILITY_MISSING, 'demo runs only with --no-model')
    with tempfile.TemporaryDirectory(prefix='h2ds4-demo-') as tmp:
        res = run_lab(Path(tmp), [args.fixture], k=args.k)
    _out(res)
    return 0


def cmd_ab(args, s: Settings | None) -> int:
    from .benchmarks.ab import run_ab
    out = Path(args.output).resolve() if args.output else None
    res = run_ab(split=args.split, k_values=tuple(args.k), output=out, limit=args.limit)
    _out(res['summary'])
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog='h2ds4', description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--config', help='absolute path to config.toml (default: XDG or repo)')
    p.add_argument('--version', action='version', version=f'h2ds4 {__version__}')
    sub = p.add_subparsers(dest='cmd', required=True)

    x = sub.add_parser('preflight', help='read-only discovery + fingerprint of a DS4 checkout')
    x.add_argument('--ds4-root', required=True)
    x.add_argument('--output')
    x.set_defaults(fn=cmd_preflight, needs_settings=False)

    x = sub.add_parser('doctor', help='check config, vendor pin, sandbox')
    x.set_defaults(fn=cmd_doctor, needs_settings=False)

    x = sub.add_parser('capability', help='capability matrix')
    x.add_argument('action', choices=['list'])
    x.add_argument('--json', action='store_true')
    x.set_defaults(fn=cmd_capability)

    x = sub.add_parser('register', help='register fixtures, base harness and profiles')
    x.add_argument('ids', nargs='*')
    x.add_argument('--all', action='store_true')
    x.add_argument('--model-profile', help='JSON file with a ModelProfile')
    x.set_defaults(fn=cmd_register)

    x = sub.add_parser('experiment', help='create/run/status/cancel/report experiments')
    x.add_argument('action', choices=['create', 'run', 'status', 'list', 'cancel', 'report'])
    x.add_argument('id', nargs='?')
    x.add_argument('--spec')
    x.add_argument('--maintenance-window', action='store_true')
    x.add_argument('--idempotency-key')
    x.add_argument('--output')
    x.add_argument('--json', action='store_true')
    x.set_defaults(fn=cmd_experiment)

    x = sub.add_parser('overlay', help='diff/approve/activate/status/rollback/export-skills')
    x.add_argument('action', choices=['diff', 'validate', 'approve', 'activate', 'status',
                                      'rollback', 'export-skills'])
    x.add_argument('id', nargs='?')
    x.add_argument('--reason', default='')
    x.add_argument('--expected-active')
    x.add_argument('--expected-revision', type=int)
    x.add_argument('--destination')
    x.add_argument('--replace', action='append')
    x.set_defaults(fn=cmd_overlay)

    x = sub.add_parser('audit', help='verify the audit hash chain')
    x.add_argument('action', choices=['verify'])
    x.set_defaults(fn=cmd_audit)

    x = sub.add_parser('serve', help='run the sidecar on its Unix socket (foreground)')
    x.add_argument('--recover-stale', action='store_true')
    x.set_defaults(fn=cmd_serve)

    x = sub.add_parser('demo', help='one fixture end to end, scripted, throwaway state')
    x.add_argument('--fixture', default='json-002')
    x.add_argument('--no-model', action='store_true')
    x.add_argument('--k', type=int, default=1, choices=[1, 2])
    x.set_defaults(fn=cmd_demo, needs_settings=False)

    x = sub.add_parser('ab', help='paired baseline vs H2 A/B over a fixture split (scripted)')
    x.add_argument('--split', default='holdout', choices=['dev', 'val', 'holdout', 'all'])
    x.add_argument('--k', type=int, nargs='+', default=[1], choices=[1, 2])
    x.add_argument('--limit', type=int)
    x.add_argument('--output')
    x.set_defaults(fn=cmd_ab, needs_settings=False)
    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as e:
        return int(Exit.INVALID_ARGS) if e.code else 0
    try:
        s = _settings(args) if getattr(args, 'needs_settings', True) else None
        if args.cmd in ('experiment',) and args.action not in ('create', 'list') and not args.id:
            raise H2DS4Error(Code.INVALID_INPUT, 'experiment id required')
        return int(args.fn(args, s) or 0)
    except PolicyError as e:
        print(json.dumps({'error': 'POLICY_DENIED', 'detail': str(e)}), file=sys.stderr)
        return int(Exit.POLICY_BLOCKED)
    except H2DS4Error as e:
        print(json.dumps(e.body()), file=sys.stderr)
        return e.exit_code
    except KeyboardInterrupt:
        return int(Exit.INTERNAL)
    except Exception as e:  # never a traceback with paths on stderr by default
        print(json.dumps({'error': 'INTERNAL_ERROR', 'detail': type(e).__name__}),
              file=sys.stderr)
        if os.environ.get('H2DS4_DEBUG') == '1':
            raise
        return int(Exit.INTERNAL)


if __name__ == '__main__':
    sys.exit(main())
