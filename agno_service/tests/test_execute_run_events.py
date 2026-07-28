from __future__ import annotations

from types import SimpleNamespace

import pytest

from ds4_agno.app import _execute_run
from ds4_agno.run_registry import RunRegistry


class ToolCallStartedEvent:
    def __init__(self):
        self.tool = SimpleNamespace(
            tool_call_id="call-1",
            tool_name="read",
        )
        self.content = None
        self.reasoning_content = None


class ToolCallCompletedEvent:
    def __init__(self):
        self.tool = SimpleNamespace(
            tool_call_id="call-1",
            tool_name="read",
            tool_call_error=False,
            result="README contents",
        )
        self.content = None
        self.reasoning_content = None


class RunCompletedEvent:
    content = "done"
    reasoning_content = None


class EventAgent:
    def __init__(self):
        self.kwargs = None

    async def arun(self, **kwargs):
        self.kwargs = kwargs
        yield ToolCallStartedEvent()
        yield ToolCallCompletedEvent()
        yield RunCompletedEvent()


@pytest.mark.asyncio
async def test_execute_run_maps_tool_events_and_forwards_run_context_ids():
    registry = RunRegistry()
    run_id = await registry.create_run("agent", "ds4-assistant")
    agent = EventAgent()

    await _execute_run(
        registry,
        {"ds4-assistant": agent},
        run_id,
        "agent",
        "ds4-assistant",
        "inspect README",
        True,
        "session-1",
    )

    record = await registry.get_run(run_id)
    assert record is not None
    assert record.status == "completed"
    assert agent.kwargs["run_id"] == run_id
    assert agent.kwargs["session_id"] == "session-1"
    tool_events = [
        event
        for event in record.events
        if event["type"] in {"tool_call", "tool_result"}
    ]
    assert tool_events[0]["content"] == {
        "toolCallId": "call-1",
        "toolName": "read",
    }
    assert tool_events[1]["content"] == {
        "toolCallId": "call-1",
        "toolName": "read",
        "isError": False,
        "result": "README contents",
    }
