"""Test that telemetry is disabled."""

from ds4_agno.settings import Settings

def test_telemetry_disabled():
    settings = Settings(
        owner_id="test-owner-id",
        service_token="x" * 32,
        model_gateway_token="y" * 32,
        ds4_model="deepseek-v4-flash",
    )
    assert settings.telemetry is False
    assert settings.tracing is False
    assert settings.scheduler is False
    assert settings.mcp_enabled is False

def test_telemetry_env_override():
    import os
    os.environ["DS4_AGNO_TELEMETRY"] = "false"
    settings = Settings(
        owner_id="test-owner-id",
        service_token="x" * 32,
        model_gateway_token="y" * 32,
        ds4_model="deepseek-v4-flash",
    )
    assert settings.telemetry is False
    os.environ.pop("DS4_AGNO_TELEMETRY", None)
