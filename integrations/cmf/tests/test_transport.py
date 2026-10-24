"""HTTP handler and AF_UNIX listener tests."""

from __future__ import annotations

import errno
import json
import os
import socket
import stat
import threading
from email.message import Message
from io import BytesIO
from types import SimpleNamespace

from ds4_cmf.api.auth import add_principal, authenticate, load_tokens
from ds4_cmf.api.errors import CmfError
from ds4_cmf.api.server import CmfServer, Handler
from ds4_cmf.storage import eventlog, projection

from support import NOW, StoreCase


class TestTransport(StoreCase):
    def setUp(self):
        super().setUp()
        self.token = add_principal(
            self.settings.tokens_file, principal_id="http-a", user_id="uid-test",
            agent_id="agent-a",
            grants=[{"project_id": "project-a", "agent_id": "agent-a", "operation": op}
                    for op in ("observe", "search", "source.read")],
        )

    def bind_server(self) -> CmfServer:
        try:
            return CmfServer(self.settings, self.ctx)
        except OSError as exc:
            if exc.errno == errno.EPERM:
                self.skipTest("AF_UNIX bind denied with EPERM by sandbox")
            raise

    def wire(self, method: str, route: str, body: bytes | None = None,
             *, headers: list[tuple[str, str]] | None = None) -> tuple[int, dict, bytes]:
        class ServerStub:
            settings = self.settings
            ctx = self.ctx
            pending = False

            def tokens(stub):
                return load_tokens(stub.settings.tokens_file)

            def project_soon(stub):
                stub.pending = True

        fake = ServerStub()
        hs = [("Host", "localhost"), ("Authorization", f"Bearer {self.token}")]
        if body is not None:
            hs.append(("Content-Length", str(len(body))))
        hs += headers or []
        request = (f"{method} {route} HTTP/1.0\r\n" +
                   "".join(f"{k}: {v}\r\n" for k, v in hs) + "\r\n").encode() + (body or b"")
        client, server_side = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(3)
        server_side.settimeout(3)
        def serve_once():
            try:
                Handler(server_side, ("local", 0), fake)
            finally:
                server_side.close()

        thread = threading.Thread(target=serve_once, daemon=True)
        thread.start()
        try:
            try:
                client.sendall(request)
            except PermissionError:
                self.skipTest("AF_UNIX socketpair send denied with EPERM by sandbox")
            raw = bytearray()
            while part := client.recv(65536):
                raw.extend(part)
        finally:
            client.close()
            thread.join(timeout=3)
            server_side.close()
        if fake.pending:
            projection.project_pending(self.ctx)
        head, _, payload = bytes(raw).partition(b"\r\n\r\n")
        self.assertTrue(head.startswith(b"HTTP/1."), bytes(raw)[:120])
        status = int(head.split(b"\r\n", 1)[0].split()[1])
        return status, json.loads(payload) if payload else {}, bytes(raw)

    def test_http_json_contract_roundtrip(self):
        self.assertEqual(self.wire("GET", "/v1/health")[0], 200)
        self.assertEqual(self.wire("POST", "/v1/admin/snapshot", b'{"name":"no-http"}')[0], 404)
        event = {"schema_version": 1, "event_key": "http", "project_id": "project-a",
                 "session_id": "session-a", "event_type": "USER_MESSAGE",
                 "occurred_at": NOW, "text": "over unix socket"}
        status, posted, _ = self.wire("POST", "/v1/events", json.dumps(event).encode())
        self.assertEqual(status, 201)
        self.assertEqual(self.wire("POST", "/v1/events", json.dumps(event).encode())[0], 200)
        query = json.dumps({"project_id": "project-a", "query": "socket", "limit": 10}).encode()
        status, found, _ = self.wire("POST", "/v1/recall", query)
        self.assertEqual(status, 200)
        self.assertEqual(len(found["items"]), 1)
        status, source, _ = self.wire("GET", f"/v1/sources/{posted['event_id']}")
        self.assertEqual((status, source["text"]), (200, "over unix socket"))

    def test_request_bounds_and_framing(self):
        valid = b'{"project_id":"project-a","query":"x"}'
        cases = [
            (b'{"project_id":"project-a","project_id":"project-b","query":"x"}', []),
            (b'{"project_id":"project-a","query":"\\ud800"}', []),
            (valid, [("Content-Length", str(len(valid)))]),
            (valid, [("Transfer-Encoding", "chunked")]),
            (b'{"project_id":"project-a","query":NaN}', []),
        ]
        for body, headers in cases:
            with self.subTest(body=body[:50], headers=headers):
                from ds4_cmf.api.server import Handler
                stub = object.__new__(Handler)
                stub.server = SimpleNamespace(settings=self.settings)
                stub.rfile = BytesIO(body)
                stub.headers = Message()
                stub.headers.add_header("Content-Length", str(len(body)))
                for key, value in headers:
                    stub.headers.add_header(key, value)
                with self.assertRaises(CmfError) as caught:
                    stub._body()
                self.assertEqual(caught.exception.code, "SCHEMA")

    def test_scope_not_disclosed_over_transport(self):
        foreign = self.observe("foreign-http", "private foreign text", project="project-b")
        self.project()
        request = json.dumps({"project_id": "project-b", "query": "private"}).encode()
        status, _, raw = self.wire("POST", "/v1/recall", request)
        self.assertEqual(status, 403)
        self.assertNotIn(b"private foreign", raw)
        hidden = self.wire("GET", f"/v1/sources/{foreign.event_id}")
        missing = self.wire("GET", "/v1/sources/00000000-0000-4000-8000-000000000000")
        self.assertEqual(hidden[0:2], missing[0:2])

    def test_unix_only_permissions_and_peer(self):
        with self.assertRaises(CmfError) as denied:
            authenticate(os.getuid() + 1, f"Bearer {self.token}", load_tokens(self.settings.tokens_file))
        self.assertEqual(denied.exception.code, "AUTH_REQUIRED")
        server = self.bind_server()
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05},
                                  daemon=True)
        try:
            mode = os.stat(self.settings.socket_path).st_mode
            self.assertTrue(stat.S_ISSOCK(mode))
            self.assertEqual(stat.S_IMODE(mode), 0o600)
            self.assertEqual(stat.S_IMODE(os.stat(self.settings.socket_path.parent).st_mode), 0o700)
            self.assertEqual(server.socket.family, socket.AF_UNIX)
            thread.start()
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(3)
                client.connect(str(self.settings.socket_path))
                client.sendall(("GET /v1/health HTTP/1.0\r\nHost: localhost\r\n"
                                f"Authorization: Bearer {self.token}\r\n\r\n").encode())
                client.shutdown(socket.SHUT_WR)
                raw = bytearray()
                while part := client.recv(65536):
                    raw.extend(part)
            self.assertIn(b"HTTP/1.0 200", raw)
            self.assertIn(b'"service":"ds4-cmf"', raw)
        finally:
            if thread.is_alive():
                server.shutdown()
                thread.join(timeout=3)
            server.server_close()

    def test_second_server_and_stale_socket(self):
        first = self.bind_server()
        try:
            with self.assertRaises(CmfError) as denied:
                CmfServer(self.settings, self.ctx)
            self.assertEqual(denied.exception.code, "DEGRADED")
        finally:
            first.server_close()
        self.assertFalse(self.settings.socket_path.exists())
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stale:
            stale.bind(str(self.settings.socket_path))
        self.assertTrue(self.settings.socket_path.exists())
        replacement = CmfServer(self.settings, self.ctx)
        try:
            self.assertTrue(stat.S_ISSOCK(os.stat(self.settings.socket_path).st_mode))
        finally:
            replacement.server_close()

    def test_restart_projects_pending_without_observe(self):
        due = self.observe("restart-due", "ready")
        deferred = self.observe("restart-deferred", "later")
        self.ctx.db.execute(
            "UPDATE projection_outbox SET next_retry_at=? WHERE event_seq=?",
            ("9999-01-01T00:00:00.000000Z", deferred.seq),
        )
        self.ctx.close()
        self.ctx = eventlog.open_store(self.settings)
        self.addCleanup(self.ctx.close)
        server = self.bind_server()
        try:
            self.assertTrue(server._project_pending)
            server.service_actions()
            self.assertEqual(self.ctx.db.execute(
                "SELECT state FROM projection_outbox WHERE event_seq=?", (due.seq,)
            ).fetchone()[0], "DONE")
            self.assertEqual(self.ctx.db.execute(
                "SELECT state FROM projection_outbox WHERE event_seq=?", (deferred.seq,)
            ).fetchone()[0], "PENDING")
            self.assertEqual(projection._status(self.ctx.db).checkpoint, due.seq)
            self.assertTrue(server._project_pending)
            self.ctx.db.execute(
                "UPDATE projection_outbox SET next_retry_at=? WHERE event_seq=?",
                ("2000-01-01T00:00:00.000000Z", deferred.seq),
            )
            server.service_actions()
            self.assertEqual(projection._status(self.ctx.db).checkpoint, deferred.seq)
            self.assertEqual(projection._status(self.ctx.db).pending, 0)
            self.assertFalse(server._project_pending)
        finally:
            server.server_close()
