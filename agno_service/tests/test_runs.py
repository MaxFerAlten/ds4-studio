"""Test the run API endpoints."""

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

def test_create_run_returns_202(client):
    resp = client.post(
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

def test_create_run_requires_auth(client):
    resp = client.post("/ds4/runs", json={"targetType": "agent", "targetId": "ds4-assistant", "message": "hi"})
    assert resp.status_code == 401

def test_create_run_unknown_target(client):
    resp = client.post(
        "/ds4/runs",
        json={"targetType": "agent", "targetId": "nonexistent-agent", "message": "hi"},
        headers={"authorization": "Bearer " + "x" * 32},
    )
    assert resp.status_code == 422

def test_get_run_returns_status(client):
    resp = client.post(
        "/ds4/runs",
        json={"targetType": "agent", "targetId": "ds4-assistant", "message": "hi"},
        headers={"authorization": "Bearer " + "x" * 32},
    )
    run_id = resp.json()["runId"]
    resp = client.get(f"/ds4/runs/{run_id}", headers={"authorization": "Bearer " + "x" * 32})
    assert resp.status_code == 200
    data = resp.json()
    assert data["runId"] == run_id
    assert data["status"] in ("queued", "completed"), f"unexpected status: {data['status']}"

def test_list_runs_returns_created_run(client):
    resp = client.post(
        "/ds4/runs",
        json={"targetType": "agent", "targetId": "ds4-assistant", "message": "hi"},
        headers={"authorization": "Bearer " + "x" * 32},
    )
    run_id = resp.json()["runId"]
    resp = client.get("/ds4/runs", headers={"authorization": "Bearer " + "x" * 32})
    assert resp.status_code == 200
    runs = resp.json()["runs"]
    assert any(r["runId"] == run_id for r in runs)

def test_list_runs_requires_auth(client):
    resp = client.get("/ds4/runs")
    assert resp.status_code == 401

def test_get_run_events_requires_auth(client):
    resp = client.get("/ds4/runs/nonexistent/events")
    assert resp.status_code == 401

def test_cancel_run_returns_cancelled(client):
    resp = client.post(
        "/ds4/runs",
        json={"targetType": "agent", "targetId": "ds4-assistant", "message": "hi"},
        headers={"authorization": "Bearer " + "x" * 32},
    )
    run_id = resp.json()["runId"]
    resp = client.post(f"/ds4/runs/{run_id}/cancel", headers={"authorization": "Bearer " + "x" * 32})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "cancelled"

def test_get_traces_returns_empty(client):
    resp = client.get("/ds4/traces", headers={"authorization": "Bearer " + "x" * 32})
    assert resp.status_code == 200
    data = resp.json()
    assert "traces" in data
    assert data["traces"] == []
