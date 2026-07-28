"""Test cancellation of runs."""

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

async def test_cancel_nonexistent_run(client):
    resp = await client.post(
        "/ds4/runs/nonexistent/cancel",
        headers={"authorization": "Bearer " + "x" * 32},
    )
    assert resp.status_code == 404

async def test_cancel_twice_idempotent(client):
    resp = await client.post(
        "/ds4/runs",
        json={"targetType": "agent", "targetId": "ds4-assistant", "message": "hi"},
        headers={"authorization": "Bearer " + "x" * 32},
    )
    run_id = resp.json()["runId"]
    resp1 = await client.post(
        f"/ds4/runs/{run_id}/cancel",
        headers={"authorization": "Bearer " + "x" * 32},
    )
    assert resp1.status_code == 200
    resp2 = await client.post(
        f"/ds4/runs/{run_id}/cancel",
        headers={"authorization": "Bearer " + "x" * 32},
    )
    assert resp2.status_code == 200  # idempotent
