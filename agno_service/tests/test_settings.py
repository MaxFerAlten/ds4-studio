"""Test settings validation."""

import pytest
from pydantic import ValidationError
from ds4_agno.settings import Settings


def test_valid_settings():
    s = Settings(
        owner_id="test-owner-id",
        service_token="x" * 32,
        model_gateway_token="y" * 32,
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
            ds4_model="deepseek-v4-flash",
        )


def test_rejects_short_token():
    with pytest.raises(ValidationError, match="32"):
        Settings(
            owner_id="test-owner-id",
            service_token="short",
            model_gateway_token="y" * 32,
            ds4_model="deepseek-v4-flash",
        )


def test_rejects_telemetry_true():
    with pytest.raises(ValidationError, match="false"):
        Settings(
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            ds4_model="deepseek-v4-flash",
            telemetry=True,
        )


def test_rejects_tracing_true():
    with pytest.raises(ValidationError, match="false"):
        Settings(
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            ds4_model="deepseek-v4-flash",
            tracing=True,
        )


def test_rejects_scheduler_true():
    with pytest.raises(ValidationError, match="false"):
        Settings(
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            ds4_model="deepseek-v4-flash",
            scheduler=True,
        )


def test_rejects_mcp_enabled_true():
    with pytest.raises(ValidationError, match="false"):
        Settings(
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            ds4_model="deepseek-v4-flash",
            mcp_enabled=True,
        )


def test_rejects_non_loopback_base_url():
    with pytest.raises(ValidationError, match="localhost"):
        Settings(
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            ds4_model="deepseek-v4-flash",
            ds4_studio_base_url="http://example.com:5173",
        )


def test_rejects_empty_model():
    with pytest.raises(ValidationError, match="model"):
        Settings(
            owner_id="test-owner-id",
            service_token="x" * 32,
            model_gateway_token="y" * 32,
            ds4_model="",
        )
