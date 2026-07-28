"""Test CORS behavior for the native Agent UI (plan SS12)."""

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
        cors_allowed_origins=["http://127.0.0.1:3000"],
    )
    app = create_app(settings=settings)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client
    await app.state.ds4_run_registry.shutdown()


async def test_agent_ui_origin_is_allowed(client):
    response = await client.options(
        "/agents",
        headers={
            "Origin": "http://127.0.0.1:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"


async def test_remote_origin_is_not_allowed(client):
    response = await client.options(
        "/agents",
        headers={
            "Origin": "https://example.invalid",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.headers.get("access-control-allow-origin") != "https://example.invalid"
