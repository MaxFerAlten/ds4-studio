"""Test health endpoint."""

import pytest
from fastapi.testclient import TestClient

from ds4_agno.app import create_app
from ds4_agno.settings import Settings


@pytest.fixture
def client():
    settings = Settings(
        owner_id="test-owner-id",
        service_token="x" * 32,
        model_gateway_token="y" * 32,
        ds4_model="deepseek-v4-flash",
    )
    app = create_app(settings=settings)
    return TestClient(app)


def test_health_returns_ok(client):
    resp = client.get("/ds4/health")
    assert resp.status_code == 200


def test_health_body(client):
    resp = client.get("/ds4/health")
    body = resp.json()
    assert body["ok"] is True
    assert body["service"] == "ds4-agno-service"
    assert body["telemetry"] is False
    assert body["tracing"] is False
    assert body["scheduler"] is False
    assert body["mcp"] is False
    assert "owner" in body
    assert "pid" in body


def test_catalog_requires_auth(client):
    resp = client.get("/ds4/catalog")
    assert resp.status_code == 401


def test_catalog_with_wrong_token(client):
    resp = client.get("/ds4/catalog", headers={"authorization": "Bearer wrong-token"})
    assert resp.status_code == 403

