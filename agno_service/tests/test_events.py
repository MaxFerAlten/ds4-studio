"""Test the events module."""

from ds4_agno.events import Ds4AgnoEvent


def test_event_model():
    event = Ds4AgnoEvent(
        type="run_started",
        run_id="test-run-id",
        target_type="agent",
        target_id="ds4-assistant",
        seq=1,
        ts="2026-07-22T20:00:00.000Z",
        content={},
    )
    assert event.type == "run_started"
    assert event.run_id == "test-run-id"
    assert event.target_type == "agent"
    assert event.target_id == "ds4-assistant"
    assert event.seq == 1
    assert event.ts == "2026-07-22T20:00:00.000Z"
    assert event.content == {}


def test_event_json_serializable():
    event = Ds4AgnoEvent(
        type="content_delta",
        run_id="test-run-id",
        target_type="agent",
        target_id="ds4-assistant",
        seq=2,
        content={"text": "Hello"},
    )
    data = event.model_dump()
    assert isinstance(data, dict)
    assert data["type"] == "content_delta"
    assert data["content"]["text"] == "Hello"


def test_event_content_accepts_string():
    """content_delta/reasoning_delta/run_failed publish plain strings, not dicts."""
    event = Ds4AgnoEvent(
        type="content_delta",
        run_id="test-run-id",
        target_type="agent",
        target_id="ds4-assistant",
        seq=2,
        content="Hello",
    )
    assert event.content == "Hello"
    assert event.model_dump()["content"] == "Hello"


def test_event_types():
    valid_types = {
        "run_started", "model_waiting", "model_started", "content_delta",
        "reasoning_delta", "tool_call", "tool_result", "step_started",
        "step_completed", "run_completed", "run_failed", "run_cancelled",
        "diagnostic_event",
    }
    for t in valid_types:
        event = Ds4AgnoEvent(
            type=t, run_id="r", target_type="agent", target_id="ds4-assistant"
        )
        assert event.type == t
