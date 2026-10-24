"""Small isolated M1 fixture; all persistent test data stays under /tmp."""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from ds4_cmf.config import Settings
from ds4_cmf.domain.events import SessionBinding, parse_event
from ds4_cmf.domain.identity import Grant, Principal
from ds4_cmf.storage import eventlog, migrations, projection
from ds4_cmf.storage.sqlite import ensure_store_dir, provision_project, provision_session


NOW = "2026-10-24T00:00:00Z"
OPS = ("admin", "observe", "search", "source.read", "source.raw")


def principal(project: str, agent: str | None, *, owner: bool = False) -> Principal:
    return Principal(
        principal_id=f"principal-{project}-{agent or 'owner'}",
        user_id="uid-test",
        agent_id=agent,
        instance_id="test",
        grants=frozenset(Grant(project, op, agent) for op in OPS),
        store_owner=owner,
    )


class StoreCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="cmf-t-", dir="/tmp"))
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.root = self.tmp / "store"
        self.settings = Settings(
            enabled=True,
            store_root=self.root,
            socket_path=self.tmp / "cmf.sock",
            tokens_file=self.tmp / "tokens.json",
        )
        ensure_store_dir(self.root, create=True)
        eventlog._load_or_create_key(self.root, create=True)
        migrations.migrate(self.settings.db_path)
        self.ctx = eventlog.open_store(self.settings)
        self.addCleanup(self.ctx.close)
        self.a = principal("project-a", "agent-a", owner=True)
        self.b = principal("project-b", "agent-b")
        provision_project(self.ctx.db, self.a, "project-a", "A")
        provision_project(self.ctx.db, self.a, "project-b", "B")
        provision_session(self.ctx.db, self.a, SessionBinding("project-a", "session-a", "agent-a"))
        owner_b = principal("project-b", None, owner=True)
        provision_session(self.ctx.db, owner_b, SessionBinding("project-b", "session-b", "agent-b"))

    def event(self, *, key: str, text: str = "Decisione affidabile", project: str = "project-a",
              session: str = "session-a", kind: str = "USER_MESSAGE"):
        return parse_event(
            {"schema_version": 1, "event_key": key, "project_id": project,
             "session_id": session, "event_type": kind, "occurred_at": NOW, "text": text},
            max_text_bytes=self.settings.limits.max_text_bytes,
        )

    def observe(self, key: str, text: str = "Decisione affidabile", *, project: str = "project-a"):
        if project == "project-a":
            return eventlog.observe(self.ctx, self.a, self.event(key=key, text=text))
        return eventlog.observe(
            self.ctx, self.b,
            self.event(key=key, text=text, project="project-b", session="session-b"),
        )

    def project(self):
        return projection.project_pending(self.ctx)
