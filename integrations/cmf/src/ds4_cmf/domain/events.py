"""Event and result types plus strict payload validation (plan §6, §8.2).

Origin, agent, trust, verification, recorded_at and event_id are assigned by
the server; a payload that carries them is rejected, not silently ignored.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone

from ..api.errors import CmfError

SCHEMA_VERSION = 1
MAX_ID_BYTES = 128
DS4_BLOB_ID = re.compile(r"sha256:[0-9a-f]{64}")
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:@+-]*")

# Declared by the authenticated host, never attested as USER authority: the
# client only labels a message as the user's, so it is stored as EXTERNAL.
# Every event stays UNTRUSTED/UNVERIFIED.  REASONING is never accepted.
ACTOR_FOR_EVENT = {
    "USER_MESSAGE": "EXTERNAL",
    "AGENT_RESPONSE_FINAL": "AGENT",
    "TOOL_RESULT": "TOOL",
    "TOOL_ERROR": "TOOL",
}

OBSERVE_FIELDS = frozenset({
    "schema_version", "event_key", "project_id", "session_id",
    "event_type", "occurred_at", "text", "ds4_blob_id",
})


@dataclass(frozen=True)
class SessionBinding:
    project_id: str
    session_id: str
    agent_id: str


@dataclass(frozen=True)
class EventInput:
    event_key: str
    project_id: str
    session_id: str
    event_type: str
    occurred_at: str  # normalized UTC, microseconds, trailing Z
    text: str | None
    ds4_blob_id: str | None


@dataclass(frozen=True)
class BlobRef:
    sha256: str
    byte_len: int
    source_kind: str  # REDACTED_TEXT (CMF copy) or DS4_CONTEXT_BLOB
    root_id: str | None = None


@dataclass(frozen=True)
class ObserveResult:
    event_id: str
    seq: int
    deduplicated: bool


@dataclass(frozen=True)
class ProjectionResult:
    checkpoint: int
    pending: int
    blocked_seq: int | None


@dataclass(frozen=True)
class SearchHit:
    memory_id: str
    event_id: str
    event_seq: int
    text: str
    source_sha256: str
    truncated: bool
    verification: str
    trust_taint: str


@dataclass(frozen=True)
class SearchResult:
    items: tuple[SearchHit, ...]
    as_of_seq: int
    fts_checkpoint: int
    lag: int
    warnings: tuple[str, ...] = ()


def check_id(value: object, *, field: str = "id") -> str:
    if (not isinstance(value, str) or not value
            or len(value.encode("utf-8")) > MAX_ID_BYTES or not _ID.fullmatch(value)
            or ".." in value):
        raise CmfError("SCHEMA", f"bad {field}")
    return value


def normalize_utc(value: object) -> str:
    """ISO 8601 with an explicit offset -> 'YYYY-MM-DDTHH:MM:SS.ffffffZ'."""
    if not isinstance(value, str) or len(value) > 40:
        raise CmfError("SCHEMA", "bad timestamp")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00") if value.endswith("Z") else value)
    except ValueError:
        raise CmfError("SCHEMA", "bad timestamp") from None
    if dt.tzinfo is None:
        raise CmfError("SCHEMA", "timestamp without offset")
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def parse_event(obj: object, *, max_text_bytes: int) -> EventInput:
    if not isinstance(obj, dict):
        raise CmfError("SCHEMA", "event must be an object")
    extra = set(obj) - OBSERVE_FIELDS
    if extra:
        raise CmfError("SCHEMA", "unknown fields")
    if obj.get("schema_version") != SCHEMA_VERSION or isinstance(obj.get("schema_version"), bool):
        raise CmfError("VERSION_CONFLICT", "schema_version")
    event_type = obj.get("event_type")
    if event_type not in ACTOR_FOR_EVENT:
        raise CmfError("SCHEMA", "event_type")
    text = obj.get("text")
    blob_id = obj.get("ds4_blob_id")
    if (text is None) == (blob_id is None):
        raise CmfError("SCHEMA", "exactly one of text, ds4_blob_id")
    if text is not None:
        if not isinstance(text, str):
            raise CmfError("SCHEMA", "text")
        try:
            size = len(text.encode("utf-8"))
        except UnicodeEncodeError:  # lone surrogate from a JSON \\ud800 escape
            raise CmfError("SCHEMA", "text is not valid UTF-8") from None
        if size > max_text_bytes:
            raise CmfError("LIMIT", "text")
    if blob_id is not None and (not isinstance(blob_id, str) or not DS4_BLOB_ID.fullmatch(blob_id)):
        raise CmfError("SCHEMA", "ds4_blob_id")
    return EventInput(
        event_key=check_id(obj.get("event_key"), field="event_key"),
        project_id=check_id(obj.get("project_id"), field="project_id"),
        session_id=check_id(obj.get("session_id"), field="session_id"),
        event_type=event_type,
        occurred_at=normalize_utc(obj.get("occurred_at")),
        text=text,
        ds4_blob_id=blob_id,
    )
