from __future__ import annotations

import json

import pytest
from agno.models.message import Message
from agno.run import RunContext

from ds4_agno.tool_context import build_bridge_context, normalize_messages
from ds4_agno.tool_errors import Ds4ToolBridgeError


def _context(**overrides):
    values = {
        "run_id": "run-1",
        "session_id": "session-1",
        "user_id": "user-1",
        "messages": [],
    }
    values.update(overrides)
    return RunContext(**values)


def test_build_bridge_context_exposes_only_allowlisted_fields():
    context = _context(
        metadata={"secret": "drop"},
        dependencies={"dependency": object()},
        session_state={"state": "drop"},
        messages=[Message(role="user", content="hello")],
    )

    payload = build_bridge_context(context, max_messages=64, max_bytes=65_536)

    assert payload == {
        "runId": "run-1",
        "sessionId": "session-1",
        "userId": "user-1",
        "history": [{"role": "user", "content": "hello"}],
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("run_id", ""),
        ("run_id", "../../etc"),
        ("session_id", "has space"),
        ("session_id", "a" * 129),
        ("user_id", "bad/user"),
    ],
)
def test_rejects_invalid_external_ids(field, value):
    with pytest.raises(Ds4ToolBridgeError) as caught:
        build_bridge_context(
            _context(**{field: value}),
            max_messages=64,
            max_bytes=65_536,
        )
    assert caught.value.code == "INVALID_TOOL_CONTEXT"


def test_optional_user_id_can_be_none():
    payload = build_bridge_context(
        _context(user_id=None),
        max_messages=64,
        max_bytes=65_536,
    )
    assert payload["userId"] is None


def test_history_keeps_recent_messages_and_tool_call_id():
    messages = [
        Message(role="user", content=f"message-{index}")
        for index in range(5)
    ]
    messages[-1].tool_call_id = "tool-call-1"
    history = normalize_messages(messages, max_messages=2, max_bytes=10_000)
    assert history == [
        {"role": "user", "content": "message-3"},
        {
            "role": "user",
            "content": "message-4",
            "tool_call_id": "tool-call-1",
        },
    ]


def test_history_byte_cap_drops_oldest_without_splitting_unicode():
    messages = [
        Message(role="user", content=f"{index}-" + ("🙂" * 20))
        for index in range(4)
    ]
    history = normalize_messages(messages, max_messages=10, max_bytes=130)
    encoded = json.dumps(
        history,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    assert len(encoded) <= 130
    assert history[-1]["content"].startswith("3-")
    assert "\uFFFD" not in history[-1]["content"]


def test_history_discards_media_non_string_content_and_extra_metadata():
    media_message = Message(role="user", content="image caption")
    media_message.images = [object()]
    messages = [
        Message(role="user", content="plain", provider_data={"secret": "drop"}),
        media_message,
        Message(role="user", content=[{"type": "text", "text": "list"}]),
    ]
    assert normalize_messages(
        messages,
        max_messages=10,
        max_bytes=10_000,
    ) == [{"role": "user", "content": "plain"}]
