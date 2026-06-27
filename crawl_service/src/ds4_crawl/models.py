from __future__ import annotations

from typing import Any

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator


class CrawlRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: AnyHttpUrl | None = None
    urls: list[AnyHttpUrl] | None = None
    browser_config: dict[str, Any] = Field(default_factory=dict)
    crawler_config: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_one_url_source(self) -> "CrawlRequest":
        has_url = self.url is not None
        has_urls = bool(self.urls)
        if has_url == has_urls:
            raise ValueError("exactly one of url or non-empty urls is required")
        return self
