from __future__ import annotations

from ds4_cmf.storage import projection

from support import StoreCase, principal


class TestProjection(StoreCase):
    def test_episode_text_and_evidence_contract(self):
        result = self.observe("episode", "Caffè decisione")
        status = self.project()
        self.assertEqual(status.pending, 0)
        row = self.ctx.db.execute(
            "SELECT m.memory_id,m.text,m.verification,m.trust_taint,l.support_type,"
            "l.excerpt_start,l.excerpt_end FROM memory_units m JOIN evidence_links l "
            "ON l.memory_id=m.memory_id WHERE l.event_seq=?", (result.seq,),
        ).fetchone()
        self.assertEqual(row, (f"episode:{result.event_id}", "Caffè decisione",
                               "UNVERIFIED", "UNTRUSTED", "OBSERVED_IN", 0,
                               len("Caffè decisione".encode("utf-8"))))

    def test_projection_crash_retry_is_atomic(self):
        result = self.observe("project-crash", "checkpoint prova")
        def crash(_seq):
            raise RuntimeError("injected projection crash")
        try:
            projection._FAULT_BEFORE_DONE = crash
            with self.assertRaises(RuntimeError):
                self.project()
            self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM memory_units").fetchone()[0], 0)
            self.assertEqual(self.ctx.db.execute("SELECT state FROM projection_outbox WHERE event_seq=?",
                                                 (result.seq,)).fetchone()[0], "PENDING")
            projection._FAULT_BEFORE_DONE = None
            self.project()
            self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM memory_units").fetchone()[0], 1)
        finally:
            projection._FAULT_BEFORE_DONE = None

    def test_checkpoint_blocks_on_earlier_pending(self):
        first = self.observe("first", "one")
        second = self.observe("second", "two")
        original = projection._materialize
        def fail_first(ctx, db, seq):
            if seq == first.seq:
                from ds4_cmf.api.errors import CmfError
                raise CmfError("SOURCE_UNAVAILABLE")
            return original(ctx, db, seq)
        try:
            projection._materialize = fail_first
            status = self.project()
            self.assertEqual(status.blocked_seq, first.seq)
            self.assertEqual(status.pending, 1)
            self.assertEqual(self.ctx.db.execute("SELECT state FROM projection_outbox WHERE event_seq=?",
                                                 (second.seq,)).fetchone()[0], "DONE")
            self.assertLess(status.checkpoint, first.seq)
        finally:
            projection._materialize = original

    def test_checkpoint_tolerates_numeric_seq_gaps(self):
        first = self.observe("before-gap", "one")
        self.project()
        self.ctx.db.execute("UPDATE sqlite_sequence SET seq=100 WHERE name='events'")
        second = self.observe("after-gap", "two")
        self.assertGreater(second.seq, first.seq + 1)
        # The watermark denotes a committed event, never an invented number.
        status = projection._status(self.ctx.db)
        self.assertEqual(status.checkpoint, first.seq)
        projection._advance_checkpoint(self.ctx.db)
        status = projection._status(self.ctx.db)
        self.assertEqual(status.checkpoint, first.seq)

    def test_rebuild_preserves_ids_and_evidence(self):
        self.observe("rebuild", "replay me")
        self.project()
        before = self.ctx.db.execute("SELECT memory_id,text FROM memory_units").fetchall()
        report = projection.rebuild_fts(self.ctx, principal("project-a", None, owner=True),
                                        project_id="project-a")
        self.assertEqual(report["changed"], 0)
        self.assertEqual(self.ctx.db.execute("SELECT memory_id,text FROM memory_units").fetchall(), before)
        self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM evidence_links").fetchone()[0], 1)

    def test_pending_survives_empty_server_cycle(self):
        # A failed row waits for its deadline, then can be retried.
        event = self.observe("later-retry", "recoverable")
        original = projection._materialize
        def fail(*_):
            from ds4_cmf.api.errors import CmfError
            raise CmfError("SOURCE_UNAVAILABLE")
        try:
            projection._materialize = fail
            self.project()
        finally:
            projection._materialize = original
        self.assertEqual(projection._status(self.ctx.db).pending, 1)
        retry_at = self.ctx.db.execute(
            "SELECT next_retry_at FROM projection_outbox WHERE event_seq=?", (event.seq,)
        ).fetchone()[0]
        self.assertGreater(retry_at, projection.utc_now())
        deferred = self.project()
        self.assertEqual(deferred.pending, 1)
        self.assertLess(deferred.checkpoint, event.seq)
        self.ctx.db.execute(
            "UPDATE projection_outbox SET next_retry_at=? WHERE event_seq=?",
            ("2000-01-01T00:00:00.000000Z", event.seq),
        )
        recovered = self.project()
        self.assertEqual(recovered.pending, 0)
        self.assertEqual(recovered.checkpoint, event.seq)

    def test_not_due_rows_are_not_retried(self):
        event = self.observe("deferred", "recoverable")
        original = projection._materialize
        def fail(*_):
            from ds4_cmf.api.errors import CmfError
            raise CmfError("SOURCE_UNAVAILABLE")
        try:
            projection._materialize = fail
            self.project()
        finally:
            projection._materialize = original
        before = self.ctx.db.execute(
            "SELECT attempts,next_retry_at FROM projection_outbox WHERE event_seq=?", (event.seq,)
        ).fetchone()
        self.assertGreater(before[1], projection.utc_now())
        writes = self.ctx.db.total_changes
        self.assertEqual(self.project().pending, 1)
        self.assertEqual(self.ctx.db.total_changes, writes)
        self.assertEqual(self.ctx.db.execute(
            "SELECT attempts,next_retry_at FROM projection_outbox WHERE event_seq=?", (event.seq,)
        ).fetchone(), before)

    def test_projector_reschedules_pending_batch(self):
        from dataclasses import replace
        from ds4_cmf.api.server import CmfServer
        for i in range(3):
            self.observe(f"batch-{i}", f"item {i}")
        self.ctx.settings = replace(
            self.settings,
            limits=replace(self.settings.limits, projection_batch=2),
        )
        class FakeServer:
            ctx = self.ctx
            _project_pending = True
        service = FakeServer()
        CmfServer.service_actions(service)
        self.assertEqual(projection._status(self.ctx.db).pending, 1)
        # One more service cycle must be scheduled without another observe.
        self.assertTrue(service._project_pending)
        CmfServer.service_actions(service)
        self.assertEqual(projection._status(self.ctx.db).pending, 0)
        self.assertFalse(service._project_pending)
        writes = self.ctx.db.total_changes
        CmfServer.service_actions(service)
        self.assertEqual(self.ctx.db.total_changes, writes)

    def test_projector_retries_after_unexpected_failure(self):
        from ds4_cmf.api.server import CmfServer
        self.observe("busy-retry", "recoverable")
        class FakeServer:
            ctx = self.ctx
            _project_pending = True
        service = FakeServer()
        original = projection.project_pending
        try:
            def busy(*_):
                import sqlite3
                raise sqlite3.OperationalError("database is locked")
            projection.project_pending = busy
            CmfServer.service_actions(service)
        finally:
            projection.project_pending = original
        self.assertEqual(projection._status(self.ctx.db).pending, 1)
        self.assertTrue(service._project_pending)
