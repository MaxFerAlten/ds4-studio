from __future__ import annotations

import asyncio

import pytest
from agno.models.message import Message
from agno.run import RunContext

from ds4_agno.tool_client import ToolBridgeResult, ToolCatalog, catalog_digest
from ds4_agno.tool_errors import Ds4ToolBridgeError
from ds4_agno.tool_factory import build_ds4_tools


def _catalog(names=("read", "list")):
    tools = [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": f"{name} description",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                    "additionalProperties": False,
                },
            },
        }
        for name in names
    ]
    return ToolCatalog(
        protocol_version=1,
        profile="safe",
        tools=tuple(tools),
        catalog_digest=catalog_digest(tools),
    )


def _run_context():
    return RunContext(
        run_id="run-1",
        session_id="session-1",
        user_id="user-1",
        messages=[Message(role="user", content="inspect README")],
    )


class FakeClient:
    def __init__(self):
        self.calls = []
        self.cancel_calls = []
        self.result = ToolBridgeResult(
            tool_name="read",
            content="success",
            is_error=False,
            guarded=False,
            compressed=False,
            code=None,
            raw=None,
            duration_ms=1,
        )
        self.error = None

    async def execute(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.result

    async def cancel(self, **kwargs):
        self.cancel_calls.append(kwargs)


def test_factory_preserves_catalog_order_schema_and_distinct_entrypoints():
    client = FakeClient()
    catalog = _catalog()
    tools = build_ds4_tools(
        client=client,
        catalog=catalog,
        max_history_messages=64,
        max_history_bytes=65_536,
    )

    assert [tool.name for tool in tools] == ["read", "list"]
    assert [tool.description for tool in tools] == [
        "read description",
        "list description",
    ]
    assert tools[0].parameters == catalog.tools[0]["function"]["parameters"]
    assert tools[0].skip_entrypoint_processing is True
    assert tools[0].entrypoint is not tools[1].entrypoint


@pytest.mark.asyncio
async def test_each_closure_calls_its_own_node_tool_name():
    client = FakeClient()
    tools = build_ds4_tools(
        client=client,
        catalog=_catalog(),
        max_history_messages=64,
        max_history_bytes=65_536,
    )

    assert await tools[0].entrypoint(
        run_context=_run_context(),
        path="README.md",
    ) == "success"
    assert await tools[1].entrypoint(
        run_context=_run_context(),
        path=".",
    ) == "success"

    assert [call["tool_name"] for call in client.calls] == ["read", "list"]
    assert client.calls[0]["arguments"] == {"path": "README.md"}
    assert client.calls[0]["context"]["history"] == [
        {"role": "user", "content": "inspect README"}
    ]
    assert client.calls[0]["call_id"].startswith("agno-")


@pytest.mark.asyncio
async def test_tool_error_result_becomes_explicit_model_result():
    client = FakeClient()
    client.result = ToolBridgeResult(
        tool_name="read",
        content="path denied",
        is_error=True,
        guarded=True,
        compressed=False,
        code="TOOL_NOT_ALLOWED",
        raw=None,
        duration_ms=1,
    )
    tool = build_ds4_tools(
        client=client,
        catalog=_catalog(("read",)),
        max_history_messages=64,
        max_history_bytes=65_536,
    )[0]

    result = await tool.entrypoint(
        run_context=_run_context(),
        path="/etc/passwd",
    )
    assert result == (
        "[DS4_TOOL_ERROR code=TOOL_NOT_ALLOWED tool=read]\n"
        "Tool execution failed. Do not claim success.\n"
        "path denied"
    )


@pytest.mark.asyncio
async def test_bridge_exception_becomes_sanitized_model_result():
    client = FakeClient()
    client.error = Ds4ToolBridgeError("TOOL_BRIDGE_TIMEOUT", "request timed out")
    tool = build_ds4_tools(
        client=client,
        catalog=_catalog(("read",)),
        max_history_messages=64,
        max_history_bytes=65_536,
    )[0]

    result = await tool.entrypoint(
        run_context=_run_context(),
        path="README.md",
    )
    assert "code=TOOL_BRIDGE_TIMEOUT" in result
    assert "request timed out" in result
    assert "Traceback" not in result


@pytest.mark.asyncio
async def test_cancellation_notifies_bridge_and_reraises_cancelled_error():
    started = asyncio.Event()

    class BlockingClient(FakeClient):
        async def execute(self, **kwargs):
            self.calls.append(kwargs)
            started.set()
            await asyncio.Future()

    client = BlockingClient()
    tool = build_ds4_tools(
        client=client,
        catalog=_catalog(("read",)),
        max_history_messages=64,
        max_history_bytes=65_536,
    )[0]
    task = asyncio.create_task(
        tool.entrypoint(run_context=_run_context(), path="README.md")
    )
    await started.wait()
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert client.cancel_calls == [
        {"run_id": "run-1", "session_id": "session-1"}
    ]


def test_factory_rejects_duplicate_names_even_for_constructed_catalog():
    catalog = _catalog(("read", "read"))
    with pytest.raises(Ds4ToolBridgeError, match="duplicate"):
        build_ds4_tools(
            client=FakeClient(),
            catalog=catalog,
            max_history_messages=64,
            max_history_bytes=65_536,
        )
