"""Test the run API endpoints."""

import pytest
import httpx
from ds4_agno.app import create_app
from ds4_agno.settings import Settings

@pytest.fixture
async def client(tmp_path, completed_test_agent):
    settings = Settings(
        owner_id="test-owner-id",
        service_token="x" * 32,
        model_gateway_token="y" * 32,
        tool_bridge_token="z" * 32,
        ds4_model="deepseek-v4-flash",
        db_file=tmp_path / "agno.db",
    )
    app = create_app(settings=settings)
    app.state.ds4_agent_registry["ds4-assistant"] = completed_test_agent
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client
    await app.state.ds4_run_registry.shutdown()

async def test_create_run_returns_202(client):
    resp = await client.post(
        "/ds4/runs",
        json={
            "targetType": "agent",
            "targetId": "ds4-assistant",
            "message": "Hello",
            "stream": True,
        },
        headers={"authorization": "Bearer " + "x" * 32},
    )
    assert resp.status_code == 202
    data = resp.json()
    assert "runId" in data
    assert data["status"] == "queued"

async def test_create_run_requires_auth(client):
    resp = await client.post(
        "/ds4/runs",
        json={
            "targetType": "agent",
            "targetId": "ds4-assistant",
            "message": "hi",
        },
    )
    assert resp.status_code == 401

async def test_create_run_unknown_target(client):
    resp = await client.post(
        "/ds4/runs",
        json={"targetType": "agent", "targetId": "nonexistent-agent", "message": "hi"},
        headers={"authorization": "Bearer " + "x" * 32},
    )
    assert resp.status_code == 422

async def test_get_run_returns_status(client):
    resp = await client.post(
        "/ds4/runs",
        json={"targetType": "agent", "targetId": "ds4-assistant", "message": "hi"},
        headers={"authorization": "Bearer " + "x" * 32},
    )
    run_id = resp.json()["runId"]
    resp = await client.get(
        f"/ds4/runs/{run_id}",
        headers={"authorization": "Bearer " + "x" * 32},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["runId"] == run_id
    assert data["status"] in ("queued", "completed"), f"unexpected status: {data['status']}"

async def test_list_runs_returns_created_run(client):
    resp = await client.post(
        "/ds4/runs",
        json={"targetType": "agent", "targetId": "ds4-assistant", "message": "hi"},
        headers={"authorization": "Bearer " + "x" * 32},
    )
    run_id = resp.json()["runId"]
    resp = await client.get(
        "/ds4/runs",
        headers={"authorization": "Bearer " + "x" * 32},
    )
    assert resp.status_code == 200
    runs = resp.json()["runs"]
    assert any(r["runId"] == run_id for r in runs)

async def test_list_runs_requires_auth(client):
    resp = await client.get("/ds4/runs")
    assert resp.status_code == 401

async def test_get_run_events_requires_auth(client):
    resp = await client.get("/ds4/runs/nonexistent/events")
    assert resp.status_code == 401

async def test_cancel_run_returns_cancelled(client):
    resp = await client.post(
        "/ds4/runs",
        json={"targetType": "agent", "targetId": "ds4-assistant", "message": "hi"},
        headers={"authorization": "Bearer " + "x" * 32},
    )
    run_id = resp.json()["runId"]
    resp = await client.post(
        f"/ds4/runs/{run_id}/cancel",
        headers={"authorization": "Bearer " + "x" * 32},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "cancelled"

async def test_get_traces_returns_empty(client):
    resp = await client.get(
        "/ds4/traces",
        headers={"authorization": "Bearer " + "x" * 32},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "traces" in data
    assert data["traces"] == []
