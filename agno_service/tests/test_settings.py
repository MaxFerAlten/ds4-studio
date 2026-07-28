"""Test settings validation."""

import pytest
from pydantic import ValidationError
from ds4_agno.settings import Settings


def test_valid_settings():
    s = Settings(
        owner_id="test-owner-id",
        service_token="x" * 32,
        model_gateway_token="y" * 32,
        tool_bridge_token="z" * 32,
        ds4_model="deepseek-v4-flash",
    )
    assert s.host == "127.0.0.1"
    assert s.port == 7777
    assert s.telemetry is False
    assert s.tracing is False
    assert s.scheduler is False
    assert s.mcp_enabled is False


def test_rejects_host_0_0_0_0():
    with pytest.raises(ValidationError, match="loopback"):
        Settings(
            host="0.0.0.0",
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            tool_bridge_token="z" * 32,
            ds4_model="deepseek-v4-flash",
        )


def test_rejects_short_token():
    with pytest.raises(ValidationError, match="32"):
        Settings(
            owner_id="test-owner-id",
            service_token="short",
            model_gateway_token="y" * 32,
            tool_bridge_token="z" * 32,
            ds4_model="deepseek-v4-flash",
        )


def test_rejects_telemetry_true():
    with pytest.raises(ValidationError, match="false"):
        Settings(
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            tool_bridge_token="z" * 32,
            ds4_model="deepseek-v4-flash",
            telemetry=True,
        )


def test_rejects_tracing_true():
    with pytest.raises(ValidationError, match="false"):
        Settings(
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            tool_bridge_token="z" * 32,
            ds4_model="deepseek-v4-flash",
            tracing=True,
        )


def test_rejects_scheduler_true():
    with pytest.raises(ValidationError, match="false"):
        Settings(
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            tool_bridge_token="z" * 32,
            ds4_model="deepseek-v4-flash",
            scheduler=True,
        )


def test_rejects_mcp_enabled_true():
    with pytest.raises(ValidationError, match="false"):
        Settings(
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            tool_bridge_token="z" * 32,
            ds4_model="deepseek-v4-flash",
            mcp_enabled=True,
        )


def test_rejects_non_loopback_base_url():
    with pytest.raises(ValidationError, match="localhost"):
        Settings(
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            tool_bridge_token="z" * 32,
            ds4_model="deepseek-v4-flash",
            ds4_studio_base_url="http://example.com:5173",
        )


def test_rejects_empty_model():
    with pytest.raises(ValidationError, match="model"):
        Settings(
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            tool_bridge_token="z" * 32,
            ds4_model="",
        )


def _settings(**overrides):
    values = {
        "owner_id": "test-owner-id",
        "service_token": "x" * 32,
        "model_gateway_token": "y" * 32,
        "tool_bridge_token": "z" * 32,
        "ds4_model": "deepseek-v4-flash",
    }
    values.update(overrides)
    return Settings(**values)


def test_cors_accepts_127_0_0_1_3000():
    s = _settings(cors_allowed_origins=["http://127.0.0.1:3000"])
    assert s.cors_allowed_origins == ["http://127.0.0.1:3000"]


def test_cors_accepts_localhost_3000():
    s = _settings(cors_allowed_origins=["http://localhost:3000"])
    assert s.cors_allowed_origins == ["http://localhost:3000"]


def test_cors_strips_trailing_slash():
    s = _settings(cors_allowed_origins=["http://127.0.0.1:3000/"])
    assert s.cors_allowed_origins == ["http://127.0.0.1:3000"]


def test_cors_dedupes():
    s = _settings(cors_allowed_origins=["http://127.0.0.1:3000", "http://127.0.0.1:3000/"])
    assert s.cors_allowed_origins == ["http://127.0.0.1:3000"]


def test_cors_rejects_remote_host():
    with pytest.raises(ValidationError, match="loopback"):
        _settings(cors_allowed_origins=["https://example.invalid"])


def test_cors_rejects_wildcard():
    with pytest.raises(ValidationError, match="loopback"):
        _settings(cors_allowed_origins=["*"])


def test_cors_rejects_path():
    with pytest.raises(ValidationError, match="path"):
        _settings(cors_allowed_origins=["http://127.0.0.1:3000/agents"])


def test_cors_rejects_query():
    with pytest.raises(ValidationError, match="path"):
        _settings(cors_allowed_origins=["http://127.0.0.1:3000?x=1"])


def test_cors_rejects_fragment():
    with pytest.raises(ValidationError, match="path"):
        _settings(cors_allowed_origins=["http://127.0.0.1:3000#frag"])


def test_accepts_enabled_safe_tools():
    settings = _settings(
        tools_enabled=True,
        tool_profile="safe",
        tool_request_timeout_seconds=45,
        tool_max_history_messages=48,
        tool_max_history_bytes=32_768,
    )
    assert settings.tools_enabled is True
    assert settings.tool_profile == "safe"
    assert settings.tool_request_timeout_seconds == 45


def test_rejects_duplicate_internal_tokens():
    with pytest.raises(ValidationError, match="distinct"):
        _settings(tool_bridge_token="x" * 32)


def test_rejects_short_tool_bridge_token():
    with pytest.raises(ValidationError, match="32"):
        _settings(tool_bridge_token="short")


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1:5173/api/internal/agno-tools",
        "http://example.com:5173/api/internal/agno-tools",
        "http://127.0.0.1:5173/api/internal/wrong",
        "http://127.0.0.1:5173/api/internal/agno-tools?x=1",
        "http://127.0.0.1:5173/api/internal/agno-tools#fragment",
        "http://user:pass@127.0.0.1:5173/api/internal/agno-tools",
    ],
)
def test_rejects_invalid_tool_bridge_url(url):
    with pytest.raises(ValidationError, match="tool bridge URL"):
        _settings(tool_bridge_base_url=url)


def test_normalizes_tool_bridge_trailing_slash():
    settings = _settings(
        tool_bridge_base_url=(
            "http://127.0.0.1:5173/api/internal/agno-tools/"
        )
    )
    assert settings.tool_bridge_base_url == (
        "http://127.0.0.1:5173/api/internal/agno-tools"
    )


@pytest.mark.parametrize("timeout", [0.09, 7_201])
def test_rejects_tool_timeout_outside_bounds(timeout):
    with pytest.raises(ValidationError, match="tool_request_timeout_seconds"):
        _settings(tool_request_timeout_seconds=timeout)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("tool_max_history_messages", 0),
        ("tool_max_history_messages", 257),
        ("tool_max_history_bytes", 1_023),
        ("tool_max_history_bytes", 1_048_577),
    ],
)
def test_rejects_tool_history_limits_outside_bounds(field, value):
    with pytest.raises(ValidationError):
        _settings(**{field: value})
