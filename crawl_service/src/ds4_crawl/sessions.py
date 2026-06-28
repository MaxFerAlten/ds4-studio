from __future__ import annotations

import secrets
from typing import Any

from .repository import Repository


class SessionManager:
    def __init__(self, repository: Repository):
        self.repository = repository

    def open(
        self,
        session_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        identifier = session_id or f"session-{secrets.token_urlsafe(12)}"
        return self.repository.create_session(identifier, metadata)

    def status(self, session_id: str) -> dict[str, Any] | None:
        return self.repository.get_session(session_id)

    def close(self, session_id: str) -> bool:
        return self.repository.close_session(session_id)
