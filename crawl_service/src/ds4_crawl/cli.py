from __future__ import annotations

import argparse
import sys


def _cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn
    host = args.host or "127.0.0.1"
    port = args.port or 9090
    uvicorn.run("ds4_crawl.app:app", host=host, port=port, log_level=args.log_level or "info")


def _cmd_doctor(args: argparse.Namespace) -> int:
    from .settings import Settings
    settings = Settings.load()
    print(f"config_dir: {settings.config_dir}")
    print(f"data_dir: {settings.data_dir}")
    print(f"database: {settings.database_path}")
    print(f"token: {settings.token_path}")
    print("doctor: ok")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ds4-crawl-service")
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="Start the crawl HTTP service")
    serve.add_argument("--host", default="127.0.0.1", help="Bind address")
    serve.add_argument("--port", type=int, default=9090, help="Bind port")
    serve.add_argument("--log-level", default="info", help="Log level")

    doctor = sub.add_parser("doctor", help="Check service readiness")
    doctor.set_defaults(cmd=_cmd_doctor)

    args = parser.parse_args(argv)
    if hasattr(args, "cmd"):
        return args.cmd(args)
    if args.command == "serve":
        return _cmd_serve(args)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
