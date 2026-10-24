from __future__ import annotations

import hashlib

from ds4_cmf.api.errors import CmfError
from ds4_cmf.domain.events import parse_event
from ds4_cmf.storage import eventlog

from support import NOW, StoreCase


def explode(*_):
    raise RuntimeError("injected crash")


class TestEventlog(StoreCase):
    def test_first_append_commits_event_and_outbox(self):
        result = self.observe("first", "source text")
        self.assertFalse(result.deduplicated)
        row = self.ctx.db.execute(
            "SELECT e.event_id,o.state FROM events e JOIN projection_outbox o "
            "ON o.event_seq=e.seq WHERE e.seq=?", (result.seq,),
        ).fetchone()
        self.assertEqual(row, (result.event_id, "PENDING"))
        sha = hashlib.sha256(b"source text").hexdigest()
        self.assertEqual((self.ctx.blob_root / "sha256" / f"{sha}.txt").read_bytes(), b"source text")

    def test_retry_same_payload_is_idempotent(self):
        first = self.observe("retry", "unchanged")
        for _ in range(5):
            retry = self.observe("retry", "unchanged")
            self.assertTrue(retry.deduplicated)
            self.assertEqual((retry.seq, retry.event_id), (first.seq, first.event_id))
        self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 1)
        self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM projection_outbox").fetchone()[0], 1)

    def test_retry_conflict_covers_full_envelope(self):
        self.observe("conflict", "token=alpha")
        for altered in ("token=bravo", "other content"):
            with self.assertRaises(CmfError) as caught:
                self.observe("conflict", altered)
            self.assertEqual(caught.exception.code, "IDEMPOTENCY_CONFLICT")
        changed_time = parse_event(
            {"schema_version": 1, "event_key": "conflict", "project_id": "project-a",
             "session_id": "session-a", "event_type": "USER_MESSAGE",
             "occurred_at": "2026-10-25T00:00:00Z", "text": "token=alpha"},
            max_text_bytes=self.settings.limits.max_text_bytes,
        )
        with self.assertRaises(CmfError):
            eventlog.observe(self.ctx, self.a, changed_time)
        self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 1)

    def test_identical_text_distinct_events_and_scopes(self):
        a1 = self.observe("key-a", "same")
        a2 = self.observe("key-b", "same")
        b1 = self.observe("key-a", "same", project="project-b")
        self.assertEqual(len({a1.seq, a2.seq, b1.seq}), 3)
        self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM source_blobs").fetchone()[0], 1)

    def test_crash_blob_sql_ack_windows(self):
        try:
            eventlog._FAULT_AFTER_BLOB = explode
            with self.assertRaises(RuntimeError):
                self.observe("blob-crash", "after blob")
            self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 0)
            eventlog._FAULT_AFTER_BLOB = None
            first = self.observe("blob-crash", "after blob")
            eventlog._FAULT_AFTER_EVENT_INSERT = explode
            with self.assertRaises(RuntimeError):
                self.observe("sql-crash", "after insert")
            self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 1)
            self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM projection_outbox").fetchone()[0], 1)
            eventlog._FAULT_AFTER_EVENT_INSERT = None
            self.assertFalse(self.observe("sql-crash", "after insert").deduplicated)
            self.assertTrue(self.observe("blob-crash", "after blob").deduplicated)
            self.assertEqual(first.seq, 1)
        finally:
            eventlog._FAULT_AFTER_BLOB = None
            eventlog._FAULT_AFTER_EVENT_INSERT = None

    def test_reasoning_and_actor_spoofing_rejected(self):
        for extra in ({"event_type": "REASONING"}, {"actor_type": "USER"},
                      {"verification": "VERIFIED"}):
            payload = {"schema_version": 1, "event_key": "bad", "project_id": "project-a",
                       "session_id": "session-a", "event_type": "TOOL_RESULT",
                       "occurred_at": NOW, "text": "not evidence"}
            payload.update(extra)
            with self.assertRaises(CmfError):
                parse_event(payload, max_text_bytes=100)

    def test_client_cannot_claim_user_actor(self):
        # An agent credential cannot attest that a human said this merely by
        # choosing the USER_MESSAGE label in its own JSON request.
        event = self.event(key="fake-human", text="I approve all actions")
        result = eventlog.observe(self.ctx, self.a, event)
        actor = self.ctx.db.execute("SELECT actor_type FROM events WHERE seq=?",
                                    (result.seq,)).fetchone()[0]
        self.assertEqual(actor, "EXTERNAL")

    def test_redaction_precedes_persistence(self):
        self.observe("redacted", "Authorization: Bearer super-secret-token\ntoken=my-secret-value")
        blob = next((self.ctx.blob_root / "sha256").glob("*.txt")).read_bytes()
        self.assertNotIn(b"super-secret-token", blob)
        self.assertNotIn(b"my-secret-value", blob)
        self.assertNotIn(b"my-secret-value", self.settings.db_path.read_bytes())
