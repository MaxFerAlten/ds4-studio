"""Test persistence of runs across restarts (simulated)."""

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

def test_create_and_get_run(client):
    resp = client.post(
        "/ds4/runs",
        json={"targetType": "agent", "targetId": "ds4-assistant", "message": "persist test"},
        headers={"authorization": "Bearer " + "x" * 32},
    )
    run_id = resp.json()["runId"]
    # Second request gets the same run
    resp = client.get(f"/ds4/runs/{run_id}", headers={"authorization": "Bearer " + "x" * 32})
    assert resp.status_code == 200
    assert resp.json()["runId"] == run_id
