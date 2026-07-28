"""Test health endpoint."""

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


async def test_health_returns_ok(client):
    resp = await client.get("/ds4/health")
    assert resp.status_code == 200


async def test_health_body(client):
    resp = await client.get("/ds4/health")
    body = resp.json()
    assert body["ok"] is True
    assert body["service"] == "ds4-agno-service"
    assert body["telemetry"] is False
    assert body["tracing"] is False
    assert body["scheduler"] is False
    assert body["mcp"] is False
    assert "owner" in body
    assert "pid" in body


async def test_catalog_requires_auth(client):
    resp = await client.get("/ds4/catalog")
    assert resp.status_code == 401


async def test_catalog_with_wrong_token(client):
    resp = await client.get(
        "/ds4/catalog",
        headers={"authorization": "Bearer wrong-token"},
    )
    assert resp.status_code == 403
