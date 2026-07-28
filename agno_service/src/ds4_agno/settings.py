from pathlib import Path
from typing import Literal
import urllib.parse

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="DS4_AGNO_",
        case_sensitive=False,
        extra="forbid",
    )

    host: str = "127.0.0.1"
    port: int = 7777
    owner_id: str = Field(min_length=8)
    service_token: str = Field(min_length=32)
    model_gateway_token: str = Field(min_length=32)
    tool_bridge_token: str = Field(min_length=32)
    ds4_studio_base_url: str = "http://127.0.0.1:5173"
    tool_bridge_base_url: str = (
        "http://127.0.0.1:5173/api/internal/agno-tools"
    )
    tools_enabled: bool = False
    tool_profile: Literal["safe", "full"] = "safe"
    tool_request_timeout_seconds: float = 120.0
    tool_max_history_messages: int = Field(default=64, ge=1, le=256)
    tool_max_history_bytes: int = Field(
        default=65_536,
        ge=1_024,
        le=1_048_576,
    )
    ds4_model: str = ""
    db_file: Path = Path("data/agno/agno.db")
    model_timeout_seconds: float = 3600.0
    telemetry: bool = False
    tracing: bool = False
    scheduler: bool = False
    mcp_enabled: bool = False
    cors_allowed_origins: list[str] = Field(default_factory=list)

    @field_validator("host")
    @classmethod
    def host_must_be_loopback(cls, v: str) -> str:
        allowed = {"127.0.0.1", "localhost", "::1"}
        if v not in allowed:
            raise ValueError(f"host must be loopback only: {allowed}")
        return v

    @field_validator("port")
    @classmethod
    def port_must_be_valid(cls, v: int) -> int:
        if not 1 <= v <= 65535:
            raise ValueError("port must be between 1 and 65535")
        return v

    @field_validator(
        "service_token",
        "model_gateway_token",
        "tool_bridge_token",
    )
    @classmethod
    def token_min_length(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("token must be at least 32 characters")
        return v

    @model_validator(mode="after")
    def internal_tokens_must_be_distinct(self) -> "Settings":
        if len(
            {
                self.service_token,
                self.model_gateway_token,
                self.tool_bridge_token,
            }
        ) != 3:
            raise ValueError("internal tokens must be distinct")
        return self

    @field_validator("tool_bridge_base_url")
    @classmethod
    def tool_bridge_url_must_be_local(cls, value: str) -> str:
        normalized = value.rstrip("/")
        parsed = urllib.parse.urlparse(normalized)
        try:
            port = parsed.port
        except ValueError as exc:
            raise ValueError("tool bridge URL has an invalid port") from exc
        if parsed.scheme != "http":
            raise ValueError("tool bridge URL must use http")
        if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("tool bridge URL must use a loopback host")
        if port is None or not 1 <= port <= 65_535:
            raise ValueError("tool bridge URL must include a valid port")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("tool bridge URL must not contain userinfo")
        if parsed.path != "/api/internal/agno-tools":
            raise ValueError("tool bridge URL path is invalid")
        if parsed.params or parsed.query or parsed.fragment:
            raise ValueError("tool bridge URL must not contain params, query, or fragment")
        return normalized

    @field_validator("tool_request_timeout_seconds")
    @classmethod
    def valid_tool_timeout(cls, value: float) -> float:
        if not 0.1 <= value <= 7_200:
            raise ValueError(
                "tool_request_timeout_seconds must be between 0.1 and 7200"
            )
        return value

    @field_validator("ds4_studio_base_url")
    @classmethod
    def base_url_loopback(cls, v: str) -> str:
        import urllib.parse
        parsed = urllib.parse.urlparse(v)
        if parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
            raise ValueError("base_url must point to localhost")
        return v

    @field_validator("telemetry", "tracing", "scheduler", "mcp_enabled")
    @classmethod
    def must_be_false(cls, v: bool) -> bool:
        if v is not False:
            raise ValueError("must be false in MVP")
        return v

    @field_validator("db_file")
    @classmethod
    def db_parent_must_be_creatable(cls, v: Path) -> Path:
        v.parent.mkdir(parents=True, exist_ok=True)
        return v

    @field_validator("ds4_model")
    @classmethod
    def model_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("model must be set (resolved from DS4 config)")
        return v

    @field_validator("cors_allowed_origins")
    @classmethod
    def cors_origins_must_be_loopback(cls, v: list[str]) -> list[str]:
        import urllib.parse

        result: list[str] = []
        for origin in v:
            stripped = origin[:-1] if origin.endswith("/") else origin
            parsed = urllib.parse.urlparse(stripped)
            if parsed.scheme not in ("http", "https"):
                raise ValueError(f"cors origin must be loopback http(s): {origin}")
            if parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
                raise ValueError(f"cors origin must be loopback: {origin}")
            if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
                raise ValueError(f"cors origin must not have path, query, or fragment: {origin}")
            if stripped not in result:
                result.append(stripped)
        return result
