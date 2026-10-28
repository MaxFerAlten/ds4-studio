"""Adversarial M1 acceptance cases missing from the original 46-test suite."""

from concurrent.futures import ThreadPoolExecutor
import contextlib
from dataclasses import replace
import errno
import hashlib
import io
import json
import os
from pathlib import Path
import random
import socket
import sqlite3
import stat
import threading
import time
import tracemalloc
from unittest import mock

from ds4_cmf import cli
from ds4_cmf.api.auth import add_principal
from ds4_cmf.api.errors import CmfError
from ds4_cmf.api.server import CmfServer, Handler
from ds4_cmf.domain.events import parse_event
from ds4_cmf.ingest import redact
from ds4_cmf.search import fts
from ds4_cmf.storage import blobs, eventlog, migrations, projection
from ds4_cmf.storage.sqlite import connect
from support import StoreCase, principal
import test_transport as transport


class TestStorageAcceptance(StoreCase):
    def test_no_outbound_or_ds4_mutation(self):
        raw = b"original DS4 evidence"
        sha = hashlib.sha256(raw).hexdigest()
        root = self.tmp / "ds4-blobs"
        (root / "sha256").mkdir(parents=True)
        path = root / "sha256" / f"{sha}.txt"
        path.write_bytes(raw)
        before = (path.read_bytes(), path.stat().st_mtime_ns, sorted(root.rglob("*")))
        self.ctx.settings = replace(self.settings, ds4_blob_roots=(("project-a", root),))
        event = replace(self.event(key="no-outbound"), text=None, ds4_blob_id=f"sha256:{sha}")
        with mock.patch("socket.socket", side_effect=AssertionError("network socket")), \
                mock.patch("socket.getaddrinfo", side_effect=AssertionError("DNS")):
            result = eventlog.observe(self.ctx, self.a, event)
            self.project()
            self.assertTrue(fts.search(self.ctx, self.a, project_id="project-a", query="evidence").items)
            self.assertEqual(eventlog.get_source(self.ctx, self.a, result.event_id)["text"], raw.decode())
        self.assertEqual((path.read_bytes(), path.stat().st_mtime_ns, sorted(root.rglob("*"))), before)

    def test_cross_scope_relations_and_updates(self):
        a = self.observe("scope-a")
        b = self.observe("scope-b", project="project-b")
        self.project()
        checks = [
            ("UPDATE sessions SET project_id='project-b' WHERE session_id='session-a'", ()),
            ("UPDATE events SET project_id='project-b' WHERE seq=?", (a.seq,)),
            ("UPDATE memory_units SET owner_agent_id='agent-b' WHERE memory_id=?", (f"episode:{a.event_id}",)),
            ("UPDATE evidence_links SET event_seq=? WHERE memory_id=?", (b.seq, f"episode:{a.event_id}")),
            ("INSERT INTO evidence_links(memory_id,event_seq,support_type) VALUES (?,?,'SUPPORTS')",
             (f"episode:{a.event_id}", b.seq)),
        ]
        for sql, params in checks:
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                self.ctx.db.execute(sql, params)
        self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM evidence_links").fetchone()[0], 2)

    def test_schema_has_only_m1_projections(self):
        names = {r[0] for r in self.ctx.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"events", "source_blobs", "sessions", "projects", "memory_units",
                         "evidence_links", "memory_fts", "projection_outbox"} <= names)
        self.assertFalse({"jobs", "vectors", "graph_edges", "facts"} & names)
        self.observe("only-fts")
        self.assertEqual(self.ctx.db.execute("SELECT DISTINCT projection FROM projection_outbox").fetchall(),
                         [("fts",)])

    def test_atomic_write_fsync_and_enospc(self):
        for operation in ("write", "fsync", "rename"):
            text = f"fault-{operation}"
            with self.subTest(operation=operation), \
                    mock.patch(f"ds4_cmf.storage.blobs.os.{operation}",
                               side_effect=OSError(errno.ENOSPC, "disk full")):
                with self.assertRaises(OSError):
                    self.observe(text, text)
            self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 0)
            for path in self.ctx.blob_root.glob("sha256/*.txt"):
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), path.stem)
        self.assertFalse(list(self.ctx.blob_root.glob("sha256/.tmp-*")))

    def test_initial_blob_directories_are_durable(self):
        synced = []
        real_sync = os.fsync
        def sync(fd):
            info = os.fstat(fd)
            if stat.S_ISDIR(info.st_mode):
                synced.append(info.st_ino)
            real_sync(fd)
        with mock.patch("ds4_cmf.storage.blobs.os.fsync", side_effect=sync):
            self.observe("first-durable", "survives directory creation")
        expected = [p.stat().st_ino for p in
                    (self.root, self.ctx.blob_root, self.ctx.blob_root / "sha256")]
        for inode in expected:
            self.assertIn(inode, synced)
        self.assertEqual(sorted(synced.index(inode) for inode in expected),
                         [synced.index(inode) for inode in expected])

    def test_ds4_missing_corrupt_or_unsaved_source(self):
        root = self.tmp / "raw"
        (root / "sha256").mkdir(parents=True)
        raw = b"available original"
        sha = hashlib.sha256(raw).hexdigest()
        path = root / "sha256" / f"{sha}.txt"
        for data in (None, b"wrong digest", b"x" * (self.settings.limits.max_ds4_bytes + 1)):
            if data is not None:
                path.write_bytes(data)
            with self.subTest(size=None if data is None else len(data)), self.assertRaises(CmfError):
                blobs.resolve_ds4_blob(root, f"sha256:{sha}", max_bytes=self.settings.limits.max_ds4_bytes)
        envelope = {"schema_version": 1, "event_key": "unsaved", "project_id": "project-a",
                    "session_id": "session-a", "event_type": "TOOL_RESULT",
                    "occurred_at": "2026-10-28T00:00:00Z", "ds4_blob_id": f"sha256:{sha}",
                    "original_saved": False}
        with self.assertRaises(CmfError):
            parse_event(envelope, max_text_bytes=self.settings.limits.max_text_bytes)

    def test_digest_is_not_an_access_capability(self):
        own = self.observe("own", "same bytes")
        foreign = self.observe("foreign", "same bytes", project="project-b")
        self.project()
        sha = self.ctx.db.execute("SELECT content_sha256 FROM events WHERE seq=?", (foreign.seq,)).fetchone()[0]
        self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM source_blobs").fetchone()[0], 1)
        for event_id in (foreign.event_id, sha):
            with self.assertRaises(CmfError) as caught:
                eventlog.get_source(self.ctx, self.a, event_id)
            self.assertEqual(caught.exception.code, "NOT_VISIBLE")
        self.assertEqual(eventlog.get_source(self.ctx, self.a, own.event_id)["text"], "same bytes")

    def test_retry_survives_redaction_revision(self):
        event = self.event(key="revision", text="Bearer secret-do-not-store")
        first = eventlog.observe(self.ctx, self.a, event)
        files = sorted(self.ctx.blob_root.rglob("*"))
        with mock.patch.object(redact, "REVISION", "redact-v-next"), \
                mock.patch.object(redact, "redact_text", side_effect=AssertionError("retry redacted again")):
            retry = eventlog.observe(self.ctx, self.a, event)
        self.assertEqual((retry.event_id, retry.seq), (first.event_id, first.seq))
        self.assertTrue(retry.deduplicated)
        self.assertEqual(sorted(self.ctx.blob_root.rglob("*")), files)

    def test_concurrent_retry_and_busy_budget(self):
        event = self.event(key="concurrent")
        barrier = threading.Barrier(2)
        def append():
            ctx = eventlog.open_store(self.settings, lock=False)
            try:
                barrier.wait(timeout=3)
                return eventlog.observe(ctx, self.a, event)
            finally:
                ctx.close()
        with ThreadPoolExecutor(max_workers=2) as workers:
            futures = [workers.submit(append) for _ in range(2)]
            results = [f.result(timeout=5) for f in futures]
        self.assertEqual(len({r.event_id for r in results}), 1)
        self.assertEqual(sum(not r.deduplicated for r in results), 1)
        contender = eventlog.open_store(replace(self.settings, limits=replace(
            self.settings.limits, busy_timeout_ms=50)), lock=False)
        try:
            self.ctx.db.execute("BEGIN IMMEDIATE")
            start = time.monotonic()
            with self.assertRaises(sqlite3.OperationalError):
                eventlog.observe(contender, self.a, self.event(key="busy"))
            self.assertLess(time.monotonic() - start, 1.0)
        finally:
            self.ctx.db.execute("ROLLBACK")
            contender.close()
        self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 1)

    def test_failure_rolls_back_event_and_outbox(self):
        with mock.patch.object(eventlog, "_FAULT_AFTER_EVENT_INSERT", side_effect=RuntimeError("fault")):
            with self.assertRaises(RuntimeError):
                self.observe("rollback")
        self.assertFalse(self.ctx.db.in_transaction)
        for table in ("events", "projection_outbox", "source_blobs"):
            self.assertEqual(self.ctx.db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], 0)
        self.assertFalse(self.observe("rollback").deduplicated)

    def test_random_append_retry_invariants(self):
        rng = random.Random(20261028)
        known = {}
        for _ in range(100):
            n = rng.randrange(20)
            key, text = f"seeded-{n}", f"evidence {n}"
            result = self.observe(key, text)
            if n in known:
                self.assertEqual(result.event_id, known[n])
                self.assertTrue(result.deduplicated)
            else:
                known[n] = result.event_id
        self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM events").fetchone()[0], len(known))
        self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM projection_outbox").fetchone()[0], len(known))
        for (event_id,) in self.ctx.db.execute("SELECT event_id FROM events"):
            self.assertIn("evidence", eventlog.get_source(self.ctx, self.a, event_id)["text"])

    def test_rebuild_switch_and_failure(self):
        self.observe("active-a", "active result")
        self.observe("active-b", "foreign result", project="project-b")
        self.project()
        before = self.ctx.db.iterdump()
        before = list(before)
        real = projection._materialize
        def fault(ctx, db, seq):
            real(ctx, db, seq)
            raise RuntimeError("failure before switch")
        with mock.patch.object(projection, "_materialize", side_effect=fault), self.assertRaises(RuntimeError):
            projection.rebuild_fts(self.ctx, principal("project-a", None, owner=True), project_id="project-a")
        self.assertEqual(list(self.ctx.db.iterdump()), before)
        self.assertEqual(len(fts.search(self.ctx, self.a, project_id="project-a", query="active").items), 1)

    def test_ties_limits_and_cli_project(self):
        for n in range(5):
            self.observe(f"tie-{n}", "tie marker")
        self.project()
        expected = sorted(r[0] for r in self.ctx.db.execute("SELECT memory_id FROM memory_units"))
        for _ in range(3):
            hits = fts.search(self.ctx, self.a, project_id="project-a", query="tie", limit=3).items
            self.assertEqual([h.memory_id for h in hits], expected[:3])
        for limit in (0, 65, True):
            with self.assertRaises(CmfError):
                fts.search(self.ctx, self.a, project_id="project-a", query="tie", limit=limit)
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as caught:
            cli.build_parser().parse_args(["search", "tie"])
        self.assertEqual(caught.exception.code, 2)
        with mock.patch.object(cli, "request", return_value=(200, {"items": [{"support": [{"event_seq": 1}]}]})) as req, \
                contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(cli.main(["search", "--project", "project-a", "tie"]), 0)
        self.assertEqual(req.call_args.args[3]["project_id"], "project-a")
        self.assertIn("support", json.loads(out.getvalue())["items"][0])

    def test_projection_memory_is_bounded(self):
        for n in range(12):
            self.observe(f"large-{n}", "bounded " + "à" * 100_000)
        tracemalloc.start()
        try:
            result = projection.project_pending(self.ctx, max_events=2)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertEqual(result.pending, 10)
        rows = self.ctx.db.execute("SELECT text,full_byte_len,truncated FROM memory_units").fetchall()
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(len(r[0].encode()) <= self.settings.limits.episode_prefix_bytes and r[2] for r in rows))
        self.assertLess(peak, 3_000_000)

    def test_future_migration_refusal_preserves_delete_database(self):
        for name in ("future.sqlite", "future?literal.sqlite", "future#literal.sqlite"):
            path = self.tmp / name
            db = sqlite3.connect(path)
            db.execute("CREATE TABLE schema_migrations(version INTEGER, checksum TEXT)")
            db.execute("INSERT INTO schema_migrations VALUES (999,'future')")
            db.commit()
            db.close()
            before, files = path.read_bytes(), sorted(self.tmp.iterdir())
            for dry_run in (True, False):
                with self.subTest(name=name, dry_run=dry_run):
                    with self.assertRaises(CmfError) as caught:
                        migrations.migrate(path, dry_run=dry_run)
                    self.assertEqual(caught.exception.code, "VERSION_CONFLICT")
                    self.assertEqual(path.read_bytes(), before)
                    self.assertEqual(sorted(self.tmp.iterdir()), files)

    def test_owner_readonly_uri_preserves_literal_store_path(self):
        root = self.tmp / "store?and#literal"
        root.mkdir(mode=0o700)
        settings = replace(self.settings, store_root=root)
        out = sqlite3.connect(settings.db_path)
        try:
            self.ctx.db.backup(out)
            out.execute("PRAGMA journal_mode=DELETE").fetchone()
        finally:
            out.close()
        owner = cli._local_owner(settings)
        self.assertTrue(owner.allowed("project-a", "admin", None))
        self.assertEqual(list(root.iterdir()), [settings.db_path])


class TestTransportAcceptance(StoreCase):
    bind_server = transport.TestTransport.bind_server
    wire = transport.TestTransport.wire

    def setUp(self):
        super().setUp()
        self.token = add_principal(
            self.settings.tokens_file, principal_id="acceptance-http", user_id="uid-test",
            agent_id="agent-a", grants=[{"project_id": "project-a", "agent_id": "agent-a",
                                         "operation": op}
                                        for op in ("observe", "search", "source.read")])

    def test_slow_client_timeout_and_shutdown(self):
        self.settings = replace(self.settings, limits=replace(self.settings.limits, request_timeout_s=0.1))
        server = self.bind_server()
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(2)
                client.connect(str(self.settings.socket_path))
                client.sendall(b"POST /v1/events HTTP/1.0\r\nContent-Length: 5\r\n")
                start = time.monotonic()
                self.assertEqual(client.recv(4096), b"")
                self.assertLess(time.monotonic() - start, 1)
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(2)
                client.connect(str(self.settings.socket_path))
                client.sendall(("GET /v1/health HTTP/1.0\r\n"
                                f"Authorization: Bearer {self.token}\r\n\r\n").encode())
                self.assertIn(b"200", client.recv(4096))
            server.shutdown()
            thread.join(timeout=2)
            self.assertFalse(thread.is_alive())
        finally:
            if thread.is_alive():
                server.shutdown()
                thread.join(timeout=2)
            server.server_close()
        self.assertFalse(self.settings.socket_path.exists())

    def test_drip_client_cannot_extend_request_deadline(self):
        self.settings = replace(self.settings, limits=replace(self.settings.limits, request_timeout_s=0.12))
        server = self.bind_server()
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        stop = threading.Event()
        sender = None
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(2)
                client.connect(str(self.settings.socket_path))
                client.sendall(("POST /v1/events HTTP/1.0\r\nContent-Length: 1000\r\n"
                                f"Authorization: Bearer {self.token}\r\n\r\n").encode())
                def drip():
                    for _ in range(15):
                        if stop.wait(0.04):
                            break
                        try:
                            client.sendall(b" ")
                        except OSError:
                            break
                sender = threading.Thread(target=drip, daemon=True)
                start = time.monotonic()
                sender.start()
                self.assertEqual(client.recv(4096), b"")
                self.assertLess(time.monotonic() - start, 0.35)
        finally:
            stop.set()
            if sender is not None:
                sender.join(timeout=1)
            server.shutdown()
            thread.join(timeout=2)
            server.server_close()

    def test_errors_and_logs_are_content_free(self):
        canary = "CANARY_PRIVATE_METHOD_20261028"
        stub = object.__new__(Handler)
        stub.command, stub._route = canary, "-"
        with contextlib.redirect_stderr(io.StringIO()) as log:
            stub.log_request(405)
        self.assertNotIn(canary, log.getvalue())
        with contextlib.redirect_stderr(io.StringIO()) as log:
            status, _, raw = self.wire("POST", "/v1/recall", json.dumps({"query": canary}).encode())
        self.assertEqual(status, 400)
        for secret in (canary, self.token, str(self.root), "Traceback"):
            self.assertNotIn(secret, log.getvalue() + raw.decode())
        valid = {"schema_version": 1, "event_key": "internal-error", "project_id": "project-a",
                 "session_id": "session-a", "event_type": "USER_MESSAGE",
                 "occurred_at": "2026-10-28T00:00:00Z", "text": canary}
        with mock.patch.object(eventlog, "observe", side_effect=RuntimeError(canary)), \
                contextlib.redirect_stderr(io.StringIO()) as log:
            status, _, raw = self.wire("POST", "/v1/events", json.dumps(valid).encode())
        self.assertEqual(status, 500)
        for secret in (canary, self.token, str(self.root), "Traceback"):
            self.assertNotIn(secret, log.getvalue() + raw.decode())

    def test_cli_does_not_print_sensitive_error_detail(self):
        canary = "PRIVATE_CONFIGURATION_TOKEN_20261028"
        with mock.patch.object(cli, "_settings", side_effect=CmfError("SCHEMA", canary)), \
                contextlib.redirect_stderr(io.StringIO()) as log:
            self.assertNotEqual(cli.main(["health"]), 0)
        self.assertNotIn(canary, log.getvalue())

    def test_unhandled_transport_error_is_content_free(self):
        canary = "PRIVATE_SOCKET_FAILURE_20261028"
        server = object.__new__(CmfServer)
        with contextlib.redirect_stderr(io.StringIO()) as log:
            try:
                raise RuntimeError(canary)
            except RuntimeError:
                server.handle_error(None, canary)
        self.assertTrue(log.getvalue())
        for secret in (canary, "Traceback", __file__):
            self.assertNotIn(secret, log.getvalue())

    def test_busy_store_returns_degraded(self):
        self.ctx.db.execute("PRAGMA busy_timeout=50")
        other = connect(self.settings.db_path)
        try:
            other.execute("BEGIN IMMEDIATE")
            body = {"schema_version": 1, "event_key": "busy-wire", "project_id": "project-a",
                    "session_id": "session-a", "event_type": "USER_MESSAGE",
                    "occurred_at": "2026-10-28T00:00:00Z", "text": "bounded contention"}
            status, response, _ = self.wire("POST", "/v1/events", json.dumps(body).encode())
            self.assertEqual(status, 503)
            self.assertEqual(response["error"]["code"], "DEGRADED")
            self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 0)
        finally:
            other.execute("ROLLBACK")
            other.close()
