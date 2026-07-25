from pathlib import Path
from pydantic import Field, field_validator
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
    ds4_studio_base_url: str = "http://127.0.0.1:5173"
    ds4_model: str = ""
    db_file: Path = Path("data/agno/agno.db")
    model_timeout_seconds: float = 3600.0
    telemetry: bool = False
    tracing: bool = False
    scheduler: bool = False
    mcp_enabled: bool = False

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

    @field_validator("service_token", "model_gateway_token")
    @classmethod
    def token_min_length(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("token must be at least 32 characters")
        return v

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
