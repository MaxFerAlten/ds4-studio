from __future__ import annotations

import json
from pathlib import Path

from ds4_cmf.api.errors import CmfError
from ds4_cmf.config import Settings
from ds4_cmf.storage import backup, eventlog

from support import StoreCase


class TestBackup(StoreCase):
    def test_restore_new_directory_and_replay(self):
        original = self.observe("for-backup", "backup marker")
        self.project()
        snapshot = backup.snapshot(self.ctx, self.a, self.tmp / "snapshot")
        restored = self.tmp / "restored"
        report = backup.restore(snapshot, restored, settings=self.settings, owner=self.a)
        self.assertEqual(report["blobs"], 1)
        settings = Settings(store_root=restored, socket_path=self.tmp / "restore.sock",
                            tokens_file=self.tmp / "tokens.json")
        ctx = eventlog.open_store(settings)
        try:
            self.assertEqual(ctx.db.execute("SELECT event_id FROM events").fetchone()[0], original.event_id)
            self.assertEqual(ctx.db.execute("SELECT COUNT(*) FROM memory_fts").fetchone()[0], 1)
            self.assertTrue(eventlog.observe(ctx, self.a, self.event(key="for-backup", text="backup marker")).deduplicated)
        finally:
            ctx.close()

    def test_partial_copy_checksum_and_enospc(self):
        self.observe("corrupt", "source to corrupt")
        snapshot = backup.snapshot(self.ctx, self.a, self.tmp / "snapshot")
        blob = next((snapshot / "blobs" / "sha256").glob("*.txt"))
        blob.write_bytes(b"X" * blob.stat().st_size)
        with self.assertRaises(CmfError):
            backup.restore(snapshot, self.tmp / "bad-restore", settings=self.settings, owner=self.a)
        self.assertFalse((self.tmp / "bad-restore").exists())

    def test_restore_dry_run_and_existing_destination(self):
        self.observe("dry", "dry-run")
        snapshot = backup.snapshot(self.ctx, self.a, self.tmp / "snapshot")
        dest = self.tmp / "new"
        self.assertTrue(backup.restore(snapshot, dest, settings=self.settings,
                                       owner=self.a, dry_run=True)["dry_run"])
        self.assertFalse(dest.exists())
        dest.mkdir()
        with self.assertRaises(CmfError):
            backup.restore(snapshot, dest, settings=self.settings, owner=self.a)

    def test_backup_owner_and_no_credentials(self):
        self.observe("owner", "only owner")
        with self.assertRaises(CmfError) as caught:
            backup.snapshot(self.ctx, self.b, self.tmp / "denied")
        self.assertEqual(caught.exception.code, "SCOPE")
        snapshot = backup.snapshot(self.ctx, self.a, self.tmp / "snapshot")
        self.assertFalse((snapshot / "tokens.json").exists())
        self.assertEqual(len((snapshot / "keys" / "idempotency.key").read_bytes()), 32)

    def test_snapshot_manifest_cannot_omit_database_blob(self):
        self.observe("omission", "must survive")
        snapshot = backup.snapshot(self.ctx, self.a, self.tmp / "snapshot")
        manifest = snapshot / "manifest.json"
        data = json.loads(manifest.read_text())
        self.assertEqual(len(data["blobs"]), 1)
        data["blobs"] = []
        manifest.write_text(json.dumps(data))
        next((snapshot / "blobs" / "sha256").glob("*.txt")).unlink()
        destination = self.tmp / "incomplete"
        with self.assertRaises(CmfError):
            backup.restore(snapshot, destination, settings=self.settings, owner=self.a)
        self.assertFalse(destination.exists())
