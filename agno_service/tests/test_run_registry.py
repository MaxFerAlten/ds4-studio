"""Test the run registry module."""

import pytest
import asyncio
from ds4_agno.run_registry import RunRegistry


@pytest.fixture
async def registry():
    return RunRegistry()


@pytest.mark.asyncio
async def test_list_runs_most_recent_first(registry):
    first = await registry.create_run("agent", "ds4-assistant")
    second = await registry.create_run("agent", "ds4-assistant")
    runs = await registry.list_runs()
    assert [r.run_id for r in runs] == [second, first]


@pytest.mark.asyncio
async def test_list_runs_empty(registry):
    assert await registry.list_runs() == []


@pytest.mark.asyncio
async def test_create_run(registry):
    run_id = await registry.create_run("agent", "ds4-assistant")
    assert run_id is not None
    record = await registry.get_run(run_id)
    assert record is not None
    assert record.status == "queued"
    assert record.target_type == "agent"
    assert record.target_id == "ds4-assistant"


@pytest.mark.asyncio
async def test_get_run_not_found(registry):
    record = await registry.get_run("nonexistent")
    assert record is None


@pytest.mark.asyncio
async def test_start_task(registry):
    run_id = await registry.create_run("agent", "ds4-assistant")
    await registry.start_task(run_id, some_coro())
    record = await registry.get_run(run_id)
    assert record.status == "running"
    assert record.task is not None


@pytest.mark.asyncio
async def test_publish_event(registry):
    run_id = await registry.create_run("agent", "ds4-assistant")
    q = await registry.subscribe(run_id)
    event = {"type": "content_delta", "run_id": run_id, "seq": 1, "content": {"text": "Hello"}}
    await registry.publish(run_id, event)
    # Check the subscriber received it
    received = await q.get()
    assert received["type"] == "content_delta"


@pytest.mark.asyncio
async def test_subscribe_and_unsubscribe(registry):
    run_id = await registry.create_run("agent", "ds4-assistant")
    q = await registry.subscribe(run_id)
    assert q in registry._runs[run_id].subscribers
    await registry.unsubscribe(run_id, q)
    assert q not in registry._runs[run_id].subscribers


@pytest.mark.asyncio
async def test_request_cancel(registry):
    run_id = await registry.create_run("agent", "ds4-assistant")
    await registry.start_task(run_id, some_coro())
    result = await registry.request_cancel(run_id)
    assert result is True
    record = await registry.get_run(run_id)
    assert record.cancel_requested is True


@pytest.mark.asyncio
async def test_mark_terminal(registry):
    run_id = await registry.create_run("agent", "ds4-assistant")
    await registry.mark_terminal(run_id, "completed")
    record = await registry.get_run(run_id)
    assert record.status == "completed"
    assert record.terminal_emitted is True


async def some_coro():
    await asyncio.sleep(0.1)
    return "done"
