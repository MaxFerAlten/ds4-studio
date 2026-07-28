from __future__ import annotations

import json
import re
from typing import Any

from agno.models.message import Message
from agno.run import RunContext

from .tool_errors import Ds4ToolBridgeError


_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
_MEDIA_FIELDS = (
    "audio",
    "images",
    "videos",
    "files",
    "audio_output",
    "image_output",
    "video_output",
    "file_output",
)


def _validate_id(value: object, field: str, *, optional: bool = False) -> str | None:
    if optional and value is None:
        return None
    if not isinstance(value, str) or not _ID_RE.fullmatch(value):
        raise Ds4ToolBridgeError(
            "INVALID_TOOL_CONTEXT",
            f"{field} is missing or invalid",
        )
    return value


def _history_size(history: list[dict[str, Any]]) -> int:
    return len(
        json.dumps(
            history,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )


def normalize_messages(
    messages: list[Message] | None,
    *,
    max_messages: int,
    max_bytes: int,
) -> list[dict[str, Any]]:
    if not messages:
        return []

    normalized: list[dict[str, Any]] = []
    for message in messages:
        if any(getattr(message, field, None) for field in _MEDIA_FIELDS):
            continue
        role = getattr(message, "role", None)
        if not isinstance(role, str) or not role:
            continue
        if not isinstance(getattr(message, "content", None), str):
            continue
        content = message.get_content_string()
        if not isinstance(content, str):
            continue
        item: dict[str, Any] = {"role": role, "content": content}
        tool_call_id = getattr(message, "tool_call_id", None)
        if isinstance(tool_call_id, str) and 0 < len(tool_call_id) <= 128:
            item["tool_call_id"] = tool_call_id
        normalized.append(item)

    normalized = normalized[-max_messages:]
    while normalized and _history_size(normalized) > max_bytes:
        normalized.pop(0)
    return normalized


def build_bridge_context(
    run_context: RunContext,
    *,
    max_messages: int,
    max_bytes: int,
) -> dict[str, Any]:
    run_id = _validate_id(run_context.run_id, "runId")
    session_id = _validate_id(run_context.session_id, "sessionId")
    user_id = _validate_id(run_context.user_id, "userId", optional=True)
    return {
        "runId": run_id,
        "sessionId": session_id,
        "userId": user_id,
        "history": normalize_messages(
            run_context.messages,
            max_messages=max_messages,
            max_bytes=max_bytes,
        ),
    }
