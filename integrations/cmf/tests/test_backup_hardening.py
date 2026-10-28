"""Backup acceptance and regressions for untrusted snapshots; no external IO."""

from __future__ import annotations

import errno
import hashlib
import json
import os
import sqlite3
import threading
import tracemalloc
from dataclasses import replace
from unittest.mock import patch

from ds4_cmf.api.errors import CmfError
from ds4_cmf.storage import backup, eventlog

from support import StoreCase


class TestBackupHardening(StoreCase):
    def make_snapshot(self, name="snapshot"):
        self.observe("backup-evidence", "complete original evidence")
        return backup.snapshot(self.ctx, self.a, self.tmp / name)

    def reject(self, snapshot, *, settings=None, suffix="denied"):
        destination = self.tmp / suffix
        before = set(self.tmp.iterdir())
        with self.assertRaises(CmfError):
            backup.restore(snapshot, destination, settings=settings or self.settings, owner=self.a)
        self.assertFalse(destination.exists())
        self.assertEqual(set(self.tmp.iterdir()), before)

    def rewrite(self, snapshot, transform):
        path = snapshot / "manifest.json"
        manifest = json.loads(path.read_text())
        transform(manifest)
        path.write_text(json.dumps(manifest))

    def test_online_wal_snapshot_consistent_cut(self):
        for n in range(16):
            self.observe(f"before-{n}", f"evidence before snapshot {n}")
        ready, stop = threading.Event(), threading.Event()
        errors, writes = [], []

        def writer():
            ctx = eventlog.open_store(self.settings, lock=False)
            try:
                for n in range(100):
                    result = eventlog.observe(ctx, self.a, self.event(key=f"during-{n}",
                                               text=f"concurrent evidence {n}"))
                    writes.append(result.seq)
                    ready.set()
                    if stop.is_set():
                        break
            except BaseException as exc:
                errors.append(exc)
                ready.set()
            finally:
                ctx.close()

        thread = threading.Thread(target=writer)
        thread.start()
        try:
            self.assertTrue(ready.wait(3), "writer did not start")
            self.assertFalse(errors, errors)
            snap = backup.snapshot(self.ctx, self.a, self.tmp / "online")
        finally:
            stop.set()
            thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertFalse(errors, errors)
        self.assertTrue(writes)
        manifest = json.loads((snap / "manifest.json").read_text())
        db = sqlite3.connect(snap / "cmf.sqlite")
        try:
            self.assertEqual(db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            high_water = db.execute("SELECT MAX(seq) FROM events").fetchone()[0]
            refs = set(db.execute("SELECT blob_sha256, byte_len FROM source_blobs"))
            self.assertEqual(high_water, manifest["high_water_seq"])
            self.assertLessEqual(high_water, max(writes))
            self.assertEqual(refs, {(r["sha256"], r["byte_len"]) for r in manifest["blobs"]})
            for sha, length in refs:
                data = (snap / "blobs" / "sha256" / f"{sha}.txt").read_bytes()
                self.assertEqual((hashlib.sha256(data).hexdigest(), len(data)), (sha, length))
        finally:
            db.close()
        backup.restore(snap, self.tmp / "online-restored", settings=self.settings, owner=self.a)

    def test_external_ds4_dependencies_are_explicit(self):
        raw = "original DS4 tool evidence".encode()
        sha = hashlib.sha256(raw).hexdigest()
        root = self.tmp / "ds4"
        (root / "sha256").mkdir(parents=True)
        source = root / "sha256" / f"{sha}.txt"
        source.write_bytes(raw)
        configured = replace(self.settings, ds4_blob_roots=(("project-a", root),))
        self.ctx.settings = configured
        event = replace(self.event(key="ds4-source"), text=None, ds4_blob_id=f"sha256:{sha}")
        eventlog.observe(self.ctx, self.a, event)
        snap = backup.snapshot(self.ctx, self.a, self.tmp / "external")
        manifest = json.loads((snap / "manifest.json").read_text())
        self.assertFalse(manifest["portable"])
        self.assertEqual(manifest["ds4_dependencies"], [{"project_id": "project-a",
                         "blob_id": f"sha256:{sha}", "sha256": sha, "byte_len": len(raw)}])
        self.reject(snap, suffix="no-root")
        backup.restore(snap, self.tmp / "external-restored", settings=configured, owner=self.a)
        self.assertEqual(source.read_bytes(), raw)
        source.write_bytes(b"X" * len(raw))
        self.reject(snap, settings=configured, suffix="changed-raw")
        self.rewrite(snap, lambda m: m.update(ds4_dependencies=[], portable=True))
        self.reject(snap, settings=configured, suffix="omitted-dependency")

    def test_manifest_paths_and_version_untrusted(self):
        snap = self.make_snapshot()
        original = (snap / "manifest.json").read_text()
        cases = [
            {"manifest_version": 999}, {"schema_version": 999},
            {"database": {"path": "../cmf.sqlite"}},
            {"key": {"path": "../keys/idempotency.key"}},
            {"portable": False}, {"high_water_seq": True},
        ]
        for n, changed in enumerate(cases):
            with self.subTest(changed=changed):
                (snap / "manifest.json").write_text(original)
                self.rewrite(snap, lambda m: m.update(changed))
                self.reject(snap, suffix=f"invalid-{n}")
        (snap / "manifest.json").write_text(original)
        (snap / "unlisted").write_bytes(b"unlisted")
        self.reject(snap, suffix="unexpected-file")

    def test_rejects_symlink_components_and_hardlinks(self):
        for n, component in enumerate(["blobs", "blobs/sha256", "keys", "manifest.json", "cmf.sqlite"]):
            with self.subTest(component=component):
                snap = self.make_snapshot(f"links-{n}")
                entry = snap / component
                target = self.tmp / f"outside-{n}"
                entry.rename(target)
                entry.symlink_to(target, target_is_directory=target.is_dir())
                self.reject(snap, suffix=f"symlink-denied-{n}")
        snap = self.make_snapshot("hardlink")
        blob = next((snap / "blobs" / "sha256").iterdir())
        os.link(blob, self.tmp / "second-link")
        self.reject(snap, suffix="hardlink-denied")
        clean = self.make_snapshot("root-link-source")
        alias = self.tmp / "root-link"
        alias.symlink_to(clean, target_is_directory=True)
        self.reject(alias, suffix="root-link-denied")

    def test_manifest_types_and_duplicate_keys(self):
        snap = self.make_snapshot()
        original = (snap / "manifest.json").read_text()
        invalid = [
            {"database": None}, {"database": []}, {"key": "bad"},
            {"blobs": None}, {"blobs": [None]}, {"ds4_dependencies": {}},
            {"schema_version": True}, {"portable": 1},
            {"database": {"path": "cmf.sqlite", "sha256": "not-a-digest", "byte_len": True}},
        ]
        for n, changed in enumerate(invalid):
            with self.subTest(changed=changed):
                (snap / "manifest.json").write_text(original)
                self.rewrite(snap, lambda m: m.update(changed))
                self.reject(snap, suffix=f"bad-type-{n}")
        (snap / "manifest.json").write_text(original.rstrip()[:-1] + ',"manifest_version":1}')
        self.reject(snap, suffix="duplicate-key")

    def test_database_schema_and_checksum_checked_before_publish(self):
        for n, sql in enumerate([
            "UPDATE schema_migrations SET version=999 WHERE version=2",
            "UPDATE schema_migrations SET checksum='wrong' WHERE version=2",
        ]):
            with self.subTest(sql=sql):
                snap = self.make_snapshot(f"db-schema-{n}")
                db = sqlite3.connect(snap / "cmf.sqlite")
                db.execute(sql)
                db.commit()
                db.close()
                raw = (snap / "cmf.sqlite").read_bytes()
                self.rewrite(snap, lambda m: m["database"].update(
                    sha256=hashlib.sha256(raw).hexdigest(), byte_len=len(raw)))
                self.reject(snap, suffix=f"schema-denied-{n}")

    def test_key_is_exactly_32_bytes(self):
        for n, length in enumerate([0, 31, 33]):
            snap = self.make_snapshot(f"key-{n}")
            data = b"x" * length
            (snap / "keys" / "idempotency.key").write_bytes(data)
            self.rewrite(snap, lambda m: m["key"].update(sha256=hashlib.sha256(data).hexdigest()))
            self.reject(snap, suffix=f"key-denied-{n}")

    def test_copied_blob_is_reverified_after_validation(self):
        snap = self.make_snapshot()
        original = backup._verify_regular
        changed = []

        def verify_then_change(path, sha, byte_len, **kwargs):
            original(path, sha, byte_len, **kwargs)
            if str(path).endswith(".txt") and not changed:
                blob = next((snap / "blobs" / "sha256").iterdir())
                blob.write_bytes(b"X" * byte_len)
                changed.append(True)

        with patch.object(backup, "_verify_regular", side_effect=verify_then_change):
            self.reject(snap, suffix="copy-race")
        self.assertTrue(changed)

    def test_schema_is_checked_on_the_bytes_copied(self):
        snap = self.make_snapshot()
        path = snap / "cmf.sqlite"
        valid = path.read_bytes()
        db = sqlite3.connect(path)
        db.execute("UPDATE schema_migrations SET version=999 WHERE version=2")
        db.commit()
        db.close()
        future = path.read_bytes()
        self.rewrite(snap, lambda m: m["database"].update(
            sha256=hashlib.sha256(future).hexdigest(), byte_len=len(future)))
        original = backup._open_entry
        opens, source_root = [], []

        def alternate_source(root_fd, entry, **kwargs):
            if str(entry) == "cmf.sqlite":
                if not source_root:
                    source_root.append(root_fd)
                if root_fd == source_root[0] and len(opens) < 3:
                    # A has the declared hash; B has the supported schema.
                    path.write_bytes([future, valid, future][len(opens)])
                    opens.append(True)
            return original(root_fd, entry, **kwargs)

        with patch.object(backup, "_open_entry", side_effect=alternate_source):
            self.reject(snap, suffix="schema-copy-race")
        self.assertEqual(len(opens), 3)

    def test_enospc_snapshot_has_no_published_or_partial_copy(self):
        self.observe("enospc", "source")
        before = set(self.tmp.iterdir())
        with patch.object(backup, "_write_file", side_effect=OSError(errno.ENOSPC, "canary-private")):
            with self.assertRaises(CmfError) as caught:
                backup.snapshot(self.ctx, self.a, self.tmp / "no-space")
        self.assertNotIn("canary-private", str(caught.exception))
        self.assertEqual(set(self.tmp.iterdir()), before)

    def test_restore_does_not_load_database_into_python_memory(self):
        self.ctx.db.execute("CREATE TABLE padding(data BLOB)")
        self.ctx.db.execute("INSERT INTO padding VALUES(zeroblob(8388608))")
        snap = self.make_snapshot()
        self.assertGreater((snap / "cmf.sqlite").stat().st_size, 8 * 1024 * 1024)
        tracemalloc.start()
        try:
            backup.restore(snap, self.tmp / "bounded", settings=self.settings, owner=self.a)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertLess(peak, 6 * 1024 * 1024, f"restore allocated {peak} Python bytes")

    def test_publish_does_not_replace_racing_empty_directory(self):
        snap = self.make_snapshot()
        original = backup._fresh_destination
        for n, operation in enumerate(("snapshot", "restore")):
            destination = self.tmp / f"racing-{n}"
            inodes = []

            def create_competing_destination(path):
                temporary = original(path)
                path.mkdir()
                inodes.append(path.stat().st_ino)
                return temporary

            with self.subTest(operation=operation), \
                    patch.object(backup, "_fresh_destination", side_effect=create_competing_destination):
                with self.assertRaises(CmfError):
                    if operation == "snapshot":
                        backup.snapshot(self.ctx, self.a, destination)
                    else:
                        backup.restore(snap, destination, settings=self.settings, owner=self.a)
            self.assertEqual(destination.stat().st_ino, inodes[0])
            self.assertEqual(list(destination.iterdir()), [])
            self.assertFalse(list(self.tmp.glob(f".{destination.name}.partial-*")))

    def test_manifest_limit_refuses_without_publish(self):
        snap = self.make_snapshot()
        with patch.object(backup, "MAX_MANIFEST_BYTES", 64):
            self.reject(snap, suffix="oversized-manifest")
            with self.assertRaises(CmfError) as caught:
                backup.snapshot(self.ctx, self.a, self.tmp / "oversized-snapshot")
            self.assertEqual(caught.exception.code, "LIMIT")
        self.assertFalse((self.tmp / "oversized-snapshot").exists())
        self.assertFalse(list(self.tmp.glob(".oversized-snapshot.partial-*")))
