"""HTTP/1.0 JSON over AF_UNIX only (plan §7; docs/M1-acceptance.md).

Serial server: one request at a time, which is also the single logical
writer.  Socket directory 0700, socket 0600, peer UID checked on every
request.  Errors and logs are content-free.
"""

from __future__ import annotations

import errno
import json
import os
import re
import socket
import socketserver
import sqlite3
import stat
import struct
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from ..config import Settings
from ..domain.events import parse_event
from ..storage import eventlog, projection
from ..search import fts
from . import auth
from .errors import CmfError

MAX_JSON_DEPTH = 32
PROJECTION_ERROR_DELAY_S = 5.0
_SOURCE_ROUTE = re.compile(r"/v1/sources/([A-Za-z0-9-]{1,64})")


def _reject_constant(name: str):
    raise CmfError("SCHEMA", f"non-finite number {name}")


def _no_duplicates(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise CmfError("SCHEMA", "duplicate key")
        out[key] = value
    return out


def _check_value(value, level: int = 1) -> None:
    """Depth bound, and no lone surrogates (JSON "\\ud800") in keys or strings."""
    if level > MAX_JSON_DEPTH:
        raise CmfError("SCHEMA", "JSON nested too deeply")
    if isinstance(value, str):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            raise CmfError("SCHEMA", "string is not valid Unicode") from None
    elif isinstance(value, dict):
        for k in value:
            _check_value(k, level)
        for v in value.values():
            _check_value(v, level + 1)
    elif isinstance(value, list):
        for v in value:
            _check_value(v, level + 1)


def parse_json_body(raw: bytes) -> object:
    try:
        text = raw.decode("utf-8")
        value = json.loads(text, object_pairs_hook=_no_duplicates, parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise CmfError("SCHEMA", "invalid JSON") from None
    _check_value(value)
    return value


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    default_request_version = "HTTP/1.0"
    server_version = "ds4-cmf"
    sys_version = ""
    server: "CmfServer"

    def setup(self) -> None:
        self.timeout = self.server.settings.limits.request_timeout_s
        super().setup()
        self._route = "-"

    # -- plumbing -----------------------------------------------------------

    def address_string(self) -> str:
        return "unix"

    def log_message(self, format, *args) -> None:  # noqa: A002 - stdlib signature
        # Never the raw request line: it may carry ids or junk from the client.
        pass

    def log_request(self, code="-", size="-") -> None:
        method = self.command if self.command in {"GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"} else "-"
        print(f"cmf {method} {self._route} {code}", file=sys.stderr, flush=True)

    def send_error(self, code, message=None, explain=None) -> None:
        mapping = {400: "SCHEMA", 404: "NOT_VISIBLE", 405: "METHOD", 408: "DEADLINE",
                   413: "LIMIT", 414: "LIMIT", 431: "LIMIT", 501: "METHOD", 505: "SCHEMA"}
        err = CmfError(mapping.get(code, "SCHEMA"))
        self.close_connection = True
        self._send(err.status, err.body())

    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(data) > self.server.settings.limits.max_response_bytes:
            status, data = 413, json.dumps(CmfError("LIMIT").body()).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _peer_uid(self) -> int:
        creds = self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED,
                                           struct.calcsize("3i"))
        return struct.unpack("3i", creds)[1]

    def _principal(self):
        return auth.authenticate(self._peer_uid(), self.headers.get("Authorization"),
                                 self.server.tokens())

    def _body(self) -> object:
        if self.headers.get("Transfer-Encoding") is not None:
            raise CmfError("SCHEMA", "chunked bodies are not accepted")
        lengths = self.headers.get_all("Content-Length") or []
        if len(lengths) != 1 or not lengths[0].isdigit():
            raise CmfError("SCHEMA", "exactly one Content-Length required")
        n = int(lengths[0])
        if n > self.server.settings.limits.max_body_bytes:
            raise CmfError("LIMIT", "body")
        raw = self.rfile.read(n)
        if len(raw) != n:
            raise CmfError("SCHEMA", "truncated body")
        return parse_json_body(raw)

    def _dispatch(self, method: str) -> None:
        path = self.path
        try:
            if method == "GET" and path == "/v1/health":
                self._route = "/v1/health"
                self._principal()
                ctx = self.server.ctx
                self._send(200, {"version": 1, "service": "ds4-cmf",
                                 "schema_version": ctx.schema_version, "state": "HEALTHY"})
            elif method == "POST" and path == "/v1/events":
                self._route = "/v1/events"
                p = self._principal()
                event = parse_event(self._body(), max_text_bytes=self.server.settings.limits.max_text_bytes)
                result = eventlog.observe(self.server.ctx, p, event)
                self.server.project_soon()
                self._send(200 if result.deduplicated else 201,
                           {"event_id": result.event_id, "seq": result.seq,
                            "deduplicated": result.deduplicated, "state": "COMMITTED"})
            elif method == "POST" and path == "/v1/recall":
                self._route = "/v1/recall"
                p = self._principal()
                body = self._body()
                if not isinstance(body, dict) or set(body) - {"project_id", "query", "limit"}:
                    raise CmfError("SCHEMA", "recall fields")
                res = fts.search(self.server.ctx, p, project_id=body.get("project_id"),
                                 query=body.get("query"), limit=body.get("limit", 10))
                self._send(200, {
                    "version": 1, "project_id": body["project_id"], "as_of_seq": res.as_of_seq,
                    "fts_checkpoint": res.fts_checkpoint, "partial": res.lag > 0,
                    "index_lag": {"fts": res.lag}, "warnings": list(res.warnings),
                    "items": [{"memory_id": h.memory_id, "kind": "EPISODE", "text": h.text,
                               "truncated": h.truncated, "verification": h.verification,
                               "trust_taint": h.trust_taint, "event_id": h.event_id,
                               "support": [{"event_seq": h.event_seq,
                                            "source_sha256": h.source_sha256}]}
                              for h in res.items]})
            elif method == "GET" and _SOURCE_ROUTE.fullmatch(path):
                self._route = "/v1/sources/{id}"
                p = self._principal()
                self._send(200, eventlog.get_source(self.server.ctx, p,
                                                    _SOURCE_ROUTE.fullmatch(path).group(1)))
            elif path in ("/v1/health", "/v1/events", "/v1/recall") \
                    or _SOURCE_ROUTE.fullmatch(path):
                raise CmfError("METHOD")
            else:
                raise CmfError("NOT_VISIBLE")
        except CmfError as exc:
            self.close_connection = True
            self._send(exc.status, exc.body())
        except (socket.timeout, TimeoutError, BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except sqlite3.OperationalError as exc:
            self.close_connection = True
            code = getattr(exc, "sqlite_errorcode", 0) & 0xff
            err = CmfError("DEGRADED" if code in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED) else "INTERNAL")
            self._send(err.status, err.body())
        except Exception as exc:  # noqa: BLE001 - last-resort, content-free
            print(f"cmf internal {type(exc).__name__}", file=sys.stderr, flush=True)
            self.close_connection = True
            self._send(500, CmfError("INTERNAL").body())

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def do_PUT(self) -> None:
        self._dispatch("PUT")

    def do_DELETE(self) -> None:
        self._dispatch("DELETE")


def _prepare_socket_path(path: Path) -> None:
    """0700 parent; refuse a live socket; remove a stale one we own."""
    if len(os.fsencode(path)) >= 108:  # sun_path, Linux
        raise CmfError("DEGRADED", "socket path too long for AF_UNIX (max 107 bytes)")
    parent = path.parent
    os.makedirs(parent, mode=0o700, exist_ok=True)
    pst = os.lstat(parent)
    if not stat.S_ISDIR(pst.st_mode) or pst.st_uid != os.getuid() or pst.st_mode & 0o077:
        raise CmfError("DEGRADED", "socket directory must be a 0700 directory owned by the service user")
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return
    if not stat.S_ISSOCK(st.st_mode) or st.st_uid != os.getuid():
        raise CmfError("DEGRADED", "socket path exists and is not our socket")
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    probe.settimeout(0.5)
    try:
        probe.connect(str(path))
    except OSError as exc:
        if exc.errno not in (errno.ECONNREFUSED, errno.ENOENT):
            raise CmfError("DEGRADED", "cannot probe existing socket") from None
        os.unlink(path)
        return
    finally:
        probe.close()
    raise CmfError("DEGRADED", "another CMF server is listening on this socket")


class CmfServer(socketserver.UnixStreamServer):
    allow_reuse_address = False
    request_queue_size = 16

    def __init__(self, settings: Settings, ctx: eventlog.Context):
        self.settings = settings
        self.ctx = ctx
        self._tokens_cache: tuple[float, dict] | None = None
        self._inode: int | None = None
        # Start scheduled: rows left PENDING by a previous run (or still in
        # backoff after the startup pass) are retried without a new observe.
        self._project_pending = True
        _prepare_socket_path(settings.socket_path)
        super().__init__(str(settings.socket_path), Handler, bind_and_activate=True)

    def server_bind(self) -> None:
        old = os.umask(0o177)
        try:
            super().server_bind()
        finally:
            os.umask(old)
        os.chmod(self.server_address, 0o600)
        self._inode = os.lstat(self.server_address).st_ino

    def tokens(self) -> dict:
        path = self.settings.tokens_file
        try:
            mtime = os.stat(path).st_mtime_ns
        except FileNotFoundError:
            mtime = -1
        if self._tokens_cache is None or self._tokens_cache[0] != mtime:
            self._tokens_cache = (mtime, auth.load_tokens(path))
        return self._tokens_cache[1]

    def project_soon(self) -> None:
        self._project_pending = True

    def service_actions(self) -> None:
        # Between requests and on every serve_forever poll: the lightweight FTS
        # projector (§8.2), one bounded batch per call.  It stays scheduled while
        # PENDING rows remain; failed rows wait out their backoff in the outbox.
        if self._project_pending and time.monotonic() >= getattr(self, "_project_after", 0.0):
            self._project_pending = False
            try:
                res = projection.project_pending(self.ctx)
                self._project_pending = res.pending > 0
            except Exception as exc:  # noqa: BLE001 - projection never kills the service
                print(f"cmf projection {type(exc).__name__}", file=sys.stderr, flush=True)
                # Rows are still PENDING in the outbox: try again, not in a tight loop.
                self._project_pending = True
                self._project_after = time.monotonic() + PROJECTION_ERROR_DELAY_S

    def finish_request(self, request, client_address) -> None:
        # A per-recv timeout alone lets a drip client monopolize this serial
        # server forever. One timer caps the complete request's socket lifetime.
        def expire():
            try:
                request.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

        timer = threading.Timer(self.settings.limits.request_timeout_s, expire)
        timer.daemon = True
        timer.start()
        try:
            super().finish_request(request, client_address)
        finally:
            timer.cancel()
            timer.join()
        self.service_actions()

    def handle_error(self, request, client_address) -> None:
        # BaseServer prints traceback, paths and the exception's raw message.
        # The transport boundary must remain content-free even on disconnect.
        print("cmf request failed", file=sys.stderr, flush=True)

    def server_close(self) -> None:
        super().server_close()
        try:
            if self._inode is not None and os.lstat(self.server_address).st_ino == self._inode:
                os.unlink(self.server_address)
        except FileNotFoundError:
            pass


def make_server(settings: Settings, ctx: eventlog.Context) -> CmfServer:
    return CmfServer(settings, ctx)
