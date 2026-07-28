"""Test persistence of runs across restarts (simulated)."""

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

async def test_create_and_get_run(client):
    resp = await client.post(
        "/ds4/runs",
        json={"targetType": "agent", "targetId": "ds4-assistant", "message": "persist test"},
        headers={"authorization": "Bearer " + "x" * 32},
    )
    run_id = resp.json()["runId"]
    # Second request gets the same run
    resp = await client.get(
        f"/ds4/runs/{run_id}",
        headers={"authorization": "Bearer " + "x" * 32},
    )
    assert resp.status_code == 200
    assert resp.json()["runId"] == run_id
