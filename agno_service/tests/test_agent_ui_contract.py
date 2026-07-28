"""Contract tests: Agent UI upstream endpoints that Agent UI expects."""

import pytest
import httpx

from ds4_agno.app import create_app
from ds4_agno.settings import Settings


@pytest.fixture
async def client(tmp_path):
    settings = Settings(
        owner_id="test-owner-id",
        service_token="x" * 32,
        model_gateway_token="y" * 32,
        tool_bridge_token="z" * 32,
        ds4_model="deepseek-v4-flash",
        db_file=tmp_path / "agno.db",
    )
    app = create_app(settings=settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client
    await app.state.ds4_run_registry.shutdown()


async def test_agent_ui_health_contract(client):
    response = await client.get("/health")
    assert response.status_code == 200


async def test_agent_ui_agents_contract(client):
    response = await client.get("/agents")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert any(item["id"] == "ds4-assistant" for item in body)


async def test_agent_ui_teams_contract(client):
    response = await client.get("/teams")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


async def test_agent_ui_sessions_contract(client):
    response = await client.get(
        "/sessions",
        params={
            "type": "agent",
            "component_id": "ds4-assistant",
            "db_id": "ds4-agno-db",
        },
    )
    assert response.status_code in (200, 404)
