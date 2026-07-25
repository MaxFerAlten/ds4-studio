"""Test cancellation of runs."""

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

def test_cancel_nonexistent_run(client):
    resp = client.post(
        "/ds4/runs/nonexistent/cancel",
        headers={"authorization": "Bearer " + "x" * 32},
    )
    assert resp.status_code == 404

def test_cancel_twice_idempotent(client):
    resp = client.post(
        "/ds4/runs",
        json={"targetType": "agent", "targetId": "ds4-assistant", "message": "hi"},
        headers={"authorization": "Bearer " + "x" * 32},
    )
    run_id = resp.json()["runId"]
    resp1 = client.post(f"/ds4/runs/{run_id}/cancel", headers={"authorization": "Bearer " + "x" * 32})
    assert resp1.status_code == 200
    resp2 = client.post(f"/ds4/runs/{run_id}/cancel", headers={"authorization": "Bearer " + "x" * 32})
    assert resp2.status_code == 200  # idempotent
