from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from ds4_cmf.api.errors import CmfError
from ds4_cmf.storage import migrations
from ds4_cmf.storage.sqlite import connect


class TestMigrations(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="cmf-m-", dir="/tmp"))
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.db_path = self.tmp / "cmf.sqlite"

    def test_empty_database_and_reapply(self):
        self.assertEqual(migrations.migrate(self.db_path), (1, 2))
        self.assertEqual(migrations.migrate(self.db_path), ())
        db = connect(self.db_path)
        try:
            self.assertEqual(migrations.check_current(db), 2)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM schema_migrations").fetchone()[0], 2)
        finally:
            db.close()

    def test_dry_run_has_no_side_effects(self):
        self.assertEqual(migrations.migrate(self.db_path, dry_run=True), (1, 2))
        self.assertFalse(self.db_path.exists())
        migrations.migrate(self.db_path)
        before = self.db_path.read_bytes()
        self.assertEqual(migrations.migrate(self.db_path, dry_run=True), ())
        self.assertEqual(self.db_path.read_bytes(), before)

    def test_checksum_drift_and_future_schema(self):
        migrations.migrate(self.db_path)
        db = connect(self.db_path)
        try:
            db.execute("UPDATE schema_migrations SET checksum='broken' WHERE version=1")
        finally:
            db.close()
        with self.assertRaises(CmfError) as caught:
            migrations.migrate(self.db_path)
        self.assertEqual(caught.exception.code, "VERSION_CONFLICT")

    def test_crash_migration_and_restore_copy(self):
        before = None
        def crash(version):
            if version == 1:
                raise RuntimeError("crash before migration commit")
        try:
            migrations._FAULT_BEFORE_COMMIT = crash
            with self.assertRaises(RuntimeError):
                migrations.migrate(self.db_path)
            db = connect(self.db_path)
            try:
                self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name='projects'").fetchone())
            finally:
                db.close()
        finally:
            migrations._FAULT_BEFORE_COMMIT = None
        self.assertEqual(migrations.migrate(self.db_path), (1, 2))

    def test_pragmas_and_foreign_keys_per_connection(self):
        migrations.migrate(self.db_path)
        db = connect(self.db_path)
        try:
            self.assertEqual(db.execute("PRAGMA foreign_keys").fetchone()[0], 1)
            self.assertEqual(db.execute("PRAGMA synchronous").fetchone()[0], 2)
            self.assertEqual(db.execute("PRAGMA journal_mode").fetchone()[0].lower(), "wal")
        finally:
            db.close()
