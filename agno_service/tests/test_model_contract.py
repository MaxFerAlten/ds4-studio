"""Test the OpenAILike adapter against a mock gateway.

This test creates a mock OpenAI-compatible server and verifies that the
DS4 OpenAILike adapter works correctly with it.
"""

import json
import uuid
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import MagicMock
from agno.db.sqlite import SqliteDb
from ds4_agno.agents import build_default_agent
from ds4_agno.model import create_ds4_model
from ds4_agno.settings import Settings

# Minimal mock OpenAI-compatible server
def create_mock_openai_server():
    app = FastAPI()
    model_id = "deepseek-v4-flash"

    @app.post("/v1/chat/completions")
    async def chat_completions(request):
        body = await request.json()
        stream = body.get("stream", False)
        if stream:
            return StreamingResponse(content=iter([b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n', b'data: [DONE]\n\n']), media_type="text/event-stream")
        return {"id": f"chat-{uuid.uuid4()}", "object": "chat.completion", "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hello from mock server"}}]}

    @app.get("/v1/models")
    async def list_models():
        return {"data": [{"id": model_id}]}

    return app

class MockGateway:
    """Simulates the Node gateway that the Agno service calls."""

    def __init__(self):
        self.app = create_mock_openai_server()
        self.client = TestClient(self.app)
        self.last_request = None

    def send(self, method, path, json_body):
        self.last_request = (method, path, json_body)
        if method == "POST" and path == "/v1/chat/completions":
            stream = json_body.get("stream", False)
            if stream:
                return self.client.post(f"http://test/{path}", json=json_body).raw  # not quite right
            return self.client.post(f"http://test/{path}", json=json_body).json()
        if method == "GET" and path == "/v1/models":
            return self.client.get(f"http://test/{path}").json()
        return {"error": "not found"}

@pytest.fixture
def settings():
    return Settings(
        owner_id="test-owner-id",
        service_token="x" * 32,
        model_gateway_token="y" * 32,
        tool_bridge_token="z" * 32,
        ds4_model="deepseek-v4-flash",
        ds4_studio_base_url="http://127.0.0.1:5173",
    )

def test_create_ds4_model_uses_gateway_url(settings):
    model = create_ds4_model(settings)
    assert model.base_url == "http://127.0.0.1:5173/api/agno-model/v1"
    assert model.api_key == settings.model_gateway_token
    assert model.max_retries == 0

def test_build_default_agent_has_id(settings):
    model = create_ds4_model(settings)
    db = MagicMock(spec=SqliteDb)
    agent = build_default_agent(model=model, db=db, tools=[])
    assert agent.id == "ds4-assistant"
    assert agent.name == "DS4 Assistant"

def test_agent_instructions_include_disclaimer(settings):
    model = create_ds4_model(settings)
    db = MagicMock(spec=SqliteDb)
    agent = build_default_agent(model=model, db=db, tools=[])
    assert any("DS4-Studio" in instr for instr in agent.instructions)

def test_model_retries_are_zero(settings):
    model = create_ds4_model(settings)
    assert model.max_retries == 0, "SDK retries must be disabled for DS4 gateway"

def test_base_url_is_loopback(settings):
    model = create_ds4_model(settings)
    assert "127.0.0.1" in model.base_url or "localhost" in model.base_url


def test_model_module_does_not_define_agent_builder():
    import ds4_agno.model as module

    assert not hasattr(module, "build_default_agent")
