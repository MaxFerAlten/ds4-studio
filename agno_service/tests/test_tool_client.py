from __future__ import annotations

import httpx
import pytest

from ds4_agno.tool_client import (
    Ds4ToolBridgeClient,
    canonical_catalog_json,
    catalog_digest,
    get_catalog_sync,
    parse_catalog_payload,
)
from ds4_agno.tool_errors import Ds4ToolBridgeError


TOKEN = "tool-secret-" + ("z" * 32)
BASE_URL = "http://127.0.0.1:5173/api/internal/agno-tools"


def _tools():
    return [
        {
            "type": "function",
            "function": {
                "name": "read",
                "description": "Read a UTF-8 text file.",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        }
    ]


def _catalog(**overrides):
    tools = overrides.pop("tools", _tools())
    payload = {
        "protocolVersion": 1,
        "profile": "safe",
        "tools": tools,
        "catalogDigest": catalog_digest(tools),
    }
    payload.update(overrides)
    return payload


def _result(**overrides):
    payload = {
        "ok": True,
        "toolName": "read",
        "content": "contents",
        "isError": False,
        "guarded": False,
        "compressed": False,
        "code": None,
        "raw": None,
        "durationMs": 12,
    }
    payload.update(overrides)
    return payload


@pytest.mark.asyncio
async def test_catalog_uses_exact_path_and_bearer_header():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/internal/agno-tools/catalog"
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        return httpx.Response(200, json=_catalog())

    client = Ds4ToolBridgeClient(
        base_url=BASE_URL,
        token=TOKEN,
        timeout_seconds=1,
        transport=httpx.MockTransport(handler),
    )
    try:
        catalog = await client.get_catalog()
    finally:
        await client.aclose()

    assert catalog.profile == "safe"
    assert catalog.tools[0]["function"]["name"] == "read"


def test_sync_catalog_bootstrap_uses_same_decoder_and_validator():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/internal/agno-tools/catalog"
        assert request.headers["authorization"] == f"Bearer {TOKEN}"
        return httpx.Response(200, json=_catalog())

    catalog = get_catalog_sync(
        base_url=BASE_URL,
        token=TOKEN,
        timeout_seconds=1,
        transport=httpx.MockTransport(handler),
    )
    assert catalog.protocol_version == 1


def test_canonical_catalog_json_sorts_keys_recursively():
    left = [{"z": 1, "nested": {"b": 2, "a": "è"}}]
    right = [{"nested": {"a": "è", "b": 2}, "z": 1}]
    assert canonical_catalog_json(left) == canonical_catalog_json(right)
    assert catalog_digest(left) == catalog_digest(right)


@pytest.mark.parametrize(
    "payload",
    [
        _catalog(protocolVersion=2),
        _catalog(profile="unknown"),
        _catalog(tools=[]),
        _catalog(
            tools=[
                *_tools(),
                _tools()[0],
            ]
        ),
        _catalog(
            tools=[
                {
                    "type": "function",
                    "function": {
                        "name": "read",
                        "description": "read",
                        "parameters": {"type": "array"},
                    },
                }
            ]
        ),
        _catalog(catalogDigest="sha256:" + ("0" * 64)),
    ],
)
def test_rejects_invalid_catalog_contract(payload):
    with pytest.raises(Ds4ToolBridgeError) as caught:
        parse_catalog_payload(payload)
    assert caught.value.code == "INVALID_TOOL_CATALOG"


@pytest.mark.asyncio
async def test_execute_forwards_exact_envelope_and_parses_result():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/internal/agno-tools/execute"
        assert request.read()
        payload = __import__("json").loads(request.content)
        assert payload == {
            "protocolVersion": 1,
            "callId": "call-1",
            "toolName": "read",
            "arguments": {"path": "README.md"},
            "context": {
                "sessionId": "session-1",
                "runId": "run-1",
                "userId": None,
                "history": [],
            },
        }
        return httpx.Response(200, json=_result())

    client = Ds4ToolBridgeClient(
        base_url=BASE_URL,
        token=TOKEN,
        timeout_seconds=1,
        transport=httpx.MockTransport(handler),
    )
    try:
        result = await client.execute(
            call_id="call-1",
            tool_name="read",
            arguments={"path": "README.md"},
            context={
                "sessionId": "session-1",
                "runId": "run-1",
                "userId": None,
                "history": [],
            },
        )
    finally:
        await client.aclose()

    assert result.tool_name == "read"
    assert result.content == "contents"
    assert result.is_error is False
    assert result.duration_ms == 12.0


@pytest.mark.asyncio
async def test_cancel_and_status():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        if request.url.path.endswith("/cancel"):
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(
            200,
            json={
                "enabled": True,
                "profile": "safe",
                "catalogCount": 1,
                "gate": {"inflight": 0, "queued": 0},
                "sessions": 0,
            },
        )

    client = Ds4ToolBridgeClient(
        base_url=BASE_URL,
        token=TOKEN,
        timeout_seconds=1,
        transport=httpx.MockTransport(handler),
    )
    try:
        await client.cancel(run_id="run-1", session_id="session-1")
        status = await client.status()
        await client.aclose()
        await client.aclose()
    finally:
        await client.aclose()

    assert seen == [
        "/api/internal/agno-tools/cancel",
        "/api/internal/agno-tools/status",
    ]
    assert status["enabled"] is True


@pytest.mark.parametrize("status", [401, 403, 409, 422, 429, 504])
@pytest.mark.asyncio
async def test_maps_json_http_errors_without_leaking_token(status):
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status,
            json={"error": "TOOL_NOT_ALLOWED", "message": "denied"},
        )

    client = Ds4ToolBridgeClient(
        base_url=BASE_URL,
        token=TOKEN,
        timeout_seconds=1,
        transport=httpx.MockTransport(handler),
    )
    try:
        with pytest.raises(Ds4ToolBridgeError) as caught:
            await client.status()
    finally:
        await client.aclose()

    assert caught.value.status_code == status
    assert caught.value.code == "TOOL_NOT_ALLOWED"
    assert TOKEN not in str(caught.value)
    assert TOKEN not in repr(caught.value)


@pytest.mark.asyncio
async def test_rejects_non_json_non_object_and_redirect_responses():
    responses = [
        httpx.Response(200, text="not-json"),
        httpx.Response(200, json=[]),
        httpx.Response(302, headers={"location": "http://example.com"}),
    ]

    def handler(_request: httpx.Request) -> httpx.Response:
        return responses.pop(0)

    client = Ds4ToolBridgeClient(
        base_url=BASE_URL,
        token=TOKEN,
        timeout_seconds=1,
        transport=httpx.MockTransport(handler),
    )
    try:
        for _ in range(3):
            with pytest.raises(Ds4ToolBridgeError):
                await client.status()
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_timeout_is_sanitized():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("secret transport details", request=request)

    client = Ds4ToolBridgeClient(
        base_url=BASE_URL,
        token=TOKEN,
        timeout_seconds=1,
        transport=httpx.MockTransport(handler),
    )
    try:
        with pytest.raises(
            Ds4ToolBridgeError,
            match="tool bridge request timed out",
        ) as caught:
            await client.status()
    finally:
        await client.aclose()

    assert caught.value.code == "TOOL_BRIDGE_TIMEOUT"
    assert "secret transport details" not in str(caught.value)
