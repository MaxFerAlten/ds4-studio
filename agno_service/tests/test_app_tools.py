from __future__ import annotations

import pytest

from ds4_agno.app import create_app
from ds4_agno.settings import Settings
from ds4_agno.tool_client import ToolCatalog, catalog_digest
from ds4_agno.tool_errors import Ds4ToolBridgeError


def _settings(tmp_path, **overrides):
    values = {
        "owner_id": "test-owner-id",
        "service_token": "s" * 32,
        "model_gateway_token": "m" * 32,
        "tool_bridge_token": "t" * 32,
        "ds4_model": "deepseek-v4-flash",
        "db_file": tmp_path / "agno.db",
    }
    values.update(overrides)
    return Settings(**values)


def _catalog(profile="safe", names=("read",)):
    tools = [
        {
            "type": "function",
            "function": {
                "name": name,
                "description": f"{name} description",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
        }
        for name in names
    ]
    return ToolCatalog(
        protocol_version=1,
        profile=profile,
        tools=tuple(tools),
        catalog_digest=catalog_digest(tools),
    )


class FakeClient:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.closed = False

    async def execute(self, **_kwargs):
        raise AssertionError("not expected during bootstrap")

    async def cancel(self, **_kwargs):
        return None

    async def aclose(self):
        self.closed = True


def test_disabled_tools_do_not_contact_catalog(tmp_path):
    called = False

    def unexpected_fetch(**_kwargs):
        nonlocal called
        called = True
        raise AssertionError("catalog fetch must be skipped")

    app = create_app(
        _settings(tmp_path, tools_enabled=False),
        catalog_fetcher=unexpected_fetch,
        tool_client_factory=FakeClient,
    )

    assert called is False
    assert app.state.ds4_tools == []
    assert app.state.ds4_tool_client is None
    assert app.state.ds4_agents[0].tool_choice is None
    assert app.state.ds4_agents[0].send_media_to_model is False


def test_enabled_tools_fail_closed_then_register_catalog_functions(tmp_path):
    captured = {}

    def fetch(**kwargs):
        captured.update(kwargs)
        return _catalog()

    app = create_app(
        _settings(
            tmp_path,
            tools_enabled=True,
            tool_profile="safe",
            tool_request_timeout_seconds=30,
        ),
        catalog_fetcher=fetch,
        tool_client_factory=FakeClient,
    )

    assert captured["timeout_seconds"] == 5.0
    assert captured["token"] == "t" * 32
    assert [tool.name for tool in app.state.ds4_tools] == ["read"]
    assert app.state.ds4_agents[0].tool_choice == "auto"
    assert app.state.ds4_agents[0].store_events is True


def test_profile_mismatch_fails_app_bootstrap(tmp_path):
    with pytest.raises(Ds4ToolBridgeError, match="profile"):
        create_app(
            _settings(
                tmp_path,
                tools_enabled=True,
                tool_profile="safe",
            ),
            catalog_fetcher=lambda **_kwargs: _catalog(profile="full"),
            tool_client_factory=FakeClient,
        )


def test_full_profile_requires_exactly_sixteen_tools(tmp_path):
    with pytest.raises(Ds4ToolBridgeError, match="exactly 16"):
        create_app(
            _settings(
                tmp_path,
                tools_enabled=True,
                tool_profile="full",
            ),
            catalog_fetcher=lambda **_kwargs: _catalog(
                profile="full",
                names=("read",),
            ),
            tool_client_factory=FakeClient,
        )
