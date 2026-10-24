from __future__ import annotations

from ds4_cmf.api.errors import CmfError
from ds4_cmf.domain.events import SessionBinding
from ds4_cmf.domain.identity import Grant, Principal
from ds4_cmf.search.fts import search
from ds4_cmf.storage.eventlog import get_source, observe
from ds4_cmf.storage.sqlite import provision_session

from support import StoreCase


class TestAcl(StoreCase):
    def test_project_agent_and_session_isolation(self):
        event = self.event(key="wrong-session", project="project-a", session="session-b")
        with self.assertRaises(CmfError) as caught:
            observe(self.ctx, self.a, event)
        self.assertEqual(caught.exception.code, "NOT_VISIBLE")
        other_agent = Principal("other", "uid-test", "agent-b", "test",
                                frozenset({Grant("project-a", "observe", "agent-b")}))
        with self.assertRaises(CmfError):
            observe(self.ctx, other_agent, self.event(key="wrong-agent"))
        self.assertEqual(self.ctx.db.execute("SELECT COUNT(*) FROM events").fetchone()[0], 0)

    def test_all_read_and_admin_paths_enforce_scope(self):
        result = self.observe("b-source", "foreignsecret", project="project-b")
        self.project()
        with self.assertRaises(CmfError) as caught:
            search(self.ctx, self.a, project_id="project-b", query="foreignsecret")
        self.assertEqual(caught.exception.code, "SCOPE")
        for event_id in (result.event_id, "00000000-0000-4000-8000-000000000000"):
            with self.assertRaises(CmfError) as denied:
                get_source(self.ctx, self.a, event_id)
            self.assertEqual(denied.exception.code, "NOT_VISIBLE")
        with self.assertRaises(CmfError):
            provision_session(self.ctx.db, self.b,
                              SessionBinding("project-a", "session-new", "agent-a"))

    def test_principal_is_host_derived(self):
        from ds4_cmf.domain.events import parse_event
        bad = {"schema_version": 1, "event_key": "spoof", "project_id": "project-a",
               "session_id": "session-a", "event_type": "USER_MESSAGE",
               "occurred_at": "2026-10-24T00:00:00Z", "text": "ok",
               "agent_id": "agent-b", "origin": "USER", "verification": "VERIFIED"}
        with self.assertRaises(CmfError) as caught:
            parse_event(bad, max_text_bytes=100)
        self.assertEqual(caught.exception.code, "SCHEMA")
