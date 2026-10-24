"""`cmf` command line (plan §46.2, §53).

Client commands talk to the running service over its Unix socket with the
bearer token from $DS4_CMF_TOKEN (never argv).  `admin` commands work on the
store directly, offline: they take the same store lock as the service, and
the local principal they act as is the store directory's owner.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import signal
import socket
import sys
from pathlib import Path
from typing import Sequence

from . import __version__
from .api.errors import CmfError


class _UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: float):
        super().__init__("localhost", timeout=timeout)
        self._path = path

    def connect(self) -> None:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        sock.connect(self._path)
        self.sock = sock


def request(settings, method: str, route: str, body: object | None = None,
            *, token: str | None = None, timeout: float = 5.0) -> tuple[int, dict]:
    token = token if token is not None else os.environ.get("DS4_CMF_TOKEN", "")
    conn = _UnixConnection(str(settings.socket_path), timeout)
    try:
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Authorization": f"Bearer {token}"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        conn.request(method, route, body=data, headers=headers)
        resp = conn.getresponse()
        raw = resp.read(32 * 1024 * 1024 + 1)
        return resp.status, json.loads(raw) if raw else {}
    finally:
        conn.close()


def _local_owner(settings):
    from .domain.identity import Grant, Principal
    from .storage.sqlite import ensure_store_dir
    ensure_store_dir(settings.store_root, create=False)
    uid = str(os.getuid())
    projects = []
    db_path = settings.db_path
    if db_path.exists():
        import sqlite3
        db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        try:
            projects = [r[0] for r in db.execute("SELECT project_id FROM projects")]
        except sqlite3.Error:
            projects = []
        finally:
            db.close()
    return Principal(principal_id=f"local-owner-{uid}", user_id=f"uid-{uid}", agent_id=None,
                     instance_id="cli", store_owner=True,
                     grants=frozenset(Grant(p, op, None) for p in projects
                                      for op in ("admin", "search", "source.read")))


def _print(obj) -> None:
    json.dump(obj, sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
    sys.stdout.write("\n")


def _settings(args):
    from .config import load_settings
    return load_settings(Path(args.config) if args.config else None,
                         overrides={"store_root": args.store, "socket_path": args.socket})


def cmd_serve(args) -> int:
    from .api.server import make_server
    from .storage import eventlog, projection
    settings = _settings(args)
    ctx = eventlog.open_store(settings)
    try:
        res = projection.project_pending(ctx, max_events=10_000)
        server = make_server(settings, ctx)
        signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
        print(f"cmf serving schema={ctx.schema_version} checkpoint={res.checkpoint} "
              f"pending={res.pending}", file=sys.stderr, flush=True)
        try:
            server.serve_forever(poll_interval=0.5)
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
    finally:
        ctx.close()
    return 0


def cmd_client(args) -> int:
    settings = _settings(args)
    if args.command == "health":
        status, body = request(settings, "GET", "/v1/health")
    elif args.command == "observe":
        text = sys.stdin.read() if args.text == "-" else args.text
        payload = {"schema_version": 1, "event_key": args.event_key, "project_id": args.project,
                   "session_id": args.session, "event_type": args.event_type,
                   "occurred_at": args.occurred_at}
        if args.ds4_blob_id:
            payload["ds4_blob_id"] = args.ds4_blob_id
        else:
            payload["text"] = text
        status, body = request(settings, "POST", "/v1/events", payload)
    elif args.command == "search":
        status, body = request(settings, "POST", "/v1/recall",
                               {"project_id": args.project, "query": args.query, "limit": args.limit})
    else:  # source
        status, body = request(settings, "GET", f"/v1/sources/{args.event_id}")
    _print(body)
    return 0 if 200 <= status < 300 else 1


def cmd_admin(args) -> int:
    from .domain.events import SessionBinding
    from .storage import backup, eventlog, migrations, projection
    from .storage.sqlite import StoreLock, ensure_store_dir, provision_project, provision_session
    settings = _settings(args)
    op = args.admin_command
    if op == "init":
        ensure_store_dir(settings.store_root, create=True)
        with StoreLock(settings.store_root):
            eventlog._load_or_create_key(settings.store_root, create=True)
            applied = migrations.migrate(settings.db_path)
        _print({"store_root": str(settings.store_root), "applied": list(applied)})
        return 0
    if op == "migrate":
        if args.dry_run:
            _print({"pending": list(migrations.migrate(settings.db_path, dry_run=True)), "dry_run": True})
            return 0
        with StoreLock(settings.store_root):
            _print({"applied": list(migrations.migrate(settings.db_path))})
        return 0
    if op == "restore":
        report = backup.restore(Path(args.source), Path(args.to), settings=settings,
                                owner=_restore_owner(), dry_run=args.dry_run)
        _print(report)
        return 0
    owner = _local_owner(settings)
    ctx = eventlog.open_store(settings)
    try:
        if op == "provision":
            provision_project(ctx.db, owner, args.project, args.display_name or args.project)
            owner = _local_owner(settings)
            if args.session:
                if not args.agent:
                    raise CmfError("SCHEMA", "--session needs --agent")
                provision_session(ctx.db, owner, SessionBinding(args.project, args.session, args.agent))
            _print({"project_id": args.project, "session_id": args.session, "agent_id": args.agent})
        elif op == "check":
            res = projection._status(ctx.db)
            integrity = ctx.db.execute("PRAGMA integrity_check").fetchone()[0]
            _print({"integrity": integrity, "schema_version": ctx.schema_version,
                    "fts_checkpoint": res.checkpoint, "fts_pending": res.pending,
                    "fts_blocked_seq": res.blocked_seq})
            return 0 if integrity == "ok" else 1
        elif op == "project":
            res = projection.project_pending(ctx, max_events=args.max_events)
            _print({"checkpoint": res.checkpoint, "pending": res.pending, "blocked_seq": res.blocked_seq})
        elif op == "rebuild":
            _print(projection.rebuild_fts(ctx, owner, project_id=args.project, dry_run=args.dry_run))
        elif op == "snapshot":
            backup.snapshot(ctx, owner, Path(args.output))
            _print({"snapshot": args.output})
        elif op == "add-token":
            from .api.auth import add_principal
            grants = []
            for spec in args.grant:
                project, _, operation = spec.partition(":")
                grants.append({"project_id": project, "operation": operation, "agent_id": args.agent})
            token = add_principal(settings.tokens_file, principal_id=args.principal_id,
                                  user_id=args.user_id, agent_id=args.agent, grants=grants)
            # The only time the token is shown; it is not stored anywhere.
            print(token)
    finally:
        ctx.close()
    return 0


def _restore_owner():
    from .domain.identity import Principal
    uid = str(os.getuid())
    return Principal(principal_id=f"local-owner-{uid}", user_id=f"uid-{uid}", agent_id=None,
                     instance_id="cli", grants=frozenset(), store_owner=True)


def cmd_config_validate(args) -> int:
    from .config import load_settings
    s = load_settings(Path(args.file), env={})
    _print({"valid": True, "enabled": s.enabled, "store_root": str(s.store_root),
            "socket_path": str(s.socket_path), "network_egress": s.network_egress})
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="cmf", description="DS4 Cognitive Memory Fabric (M1, local-only).")
    ap.add_argument("--version", action="version", version=f"cmf {__version__}")
    ap.add_argument("--config", help="TOML config file")
    ap.add_argument("--store", help="store root (overrides config/env)")
    ap.add_argument("--socket", help="socket path (overrides config/env)")
    sub = ap.add_subparsers(dest="command", required=True)

    sub.add_parser("serve", help="run the service on the Unix socket").set_defaults(func=cmd_serve)
    sub.add_parser("health", help="service health").set_defaults(func=cmd_client)
    p = sub.add_parser("observe", help="append one event")
    p.add_argument("--project", required=True)
    p.add_argument("--session", required=True)
    p.add_argument("--event-key", required=True)
    p.add_argument("--event-type", required=True,
                   choices=["USER_MESSAGE", "AGENT_RESPONSE_FINAL", "TOOL_RESULT", "TOOL_ERROR"])
    p.add_argument("--occurred-at", required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--text", help="event text, or - for stdin")
    g.add_argument("--ds4-blob-id")
    p.set_defaults(func=cmd_client)
    p = sub.add_parser("search", help="scoped lexical recall")
    p.add_argument("--project", required=True)
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("query")
    p.set_defaults(func=cmd_client)
    p = sub.add_parser("source", help="redacted source of one event")
    p.add_argument("event_id")
    p.set_defaults(func=cmd_client)

    cfg = sub.add_parser("config", help="configuration tools")
    cs = cfg.add_subparsers(dest="config_command", required=True)
    p = cs.add_parser("validate")
    p.add_argument("--file", required=True)
    p.set_defaults(func=cmd_config_validate)

    adm = sub.add_parser("admin", help="offline store administration")
    asub = adm.add_subparsers(dest="admin_command", required=True)
    asub.add_parser("init", help="create store, key and schema").set_defaults(func=cmd_admin)
    p = asub.add_parser("migrate")
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_admin)
    p = asub.add_parser("provision", help="create a project and optionally bind a session")
    p.add_argument("--project", required=True)
    p.add_argument("--display-name")
    p.add_argument("--session")
    p.add_argument("--agent")
    p.set_defaults(func=cmd_admin)
    asub.add_parser("check", help="integrity and projection status").set_defaults(func=cmd_admin)
    p = asub.add_parser("project", help="run the FTS projector")
    p.add_argument("--max-events", type=int, default=10_000)
    p.set_defaults(func=cmd_admin)
    p = asub.add_parser("rebuild", help="rebuild one project's FTS projection")
    p.add_argument("--project", required=True)
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_admin)
    p = asub.add_parser("snapshot")
    p.add_argument("--output", required=True)
    p.set_defaults(func=cmd_admin)
    p = asub.add_parser("restore")
    p.add_argument("--from", dest="source", required=True)
    p.add_argument("--to", required=True)
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(func=cmd_admin)
    p = asub.add_parser("add-token", help="register a principal; prints its token once")
    p.add_argument("--principal-id", required=True)
    p.add_argument("--user-id", required=True)
    p.add_argument("--agent")
    p.add_argument("--grant", action="append", default=[], metavar="PROJECT:OPERATION")
    p.set_defaults(func=cmd_admin)
    return ap


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except CmfError as exc:
        print(f"cmf: {exc.code}: {exc.detail or exc.body()['error']['message']}", file=sys.stderr)
        return 2
    except (ConnectionRefusedError, FileNotFoundError) as exc:
        print(f"cmf: service unavailable ({type(exc).__name__})", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
