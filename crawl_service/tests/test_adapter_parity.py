from __future__ import annotations

import hmac

import pytest
from crawl4ai import BFSDeepCrawlStrategy, CacheMode, ProxyConfig
from fastapi import HTTPException
from pydantic import ValidationError

from ds4_crawl import auth
from ds4_crawl.adapter import (
    ConfigPathError,
    ExtensionReference,
    build_browser_config,
    build_crawler_config,
)
from ds4_crawl.models import CrawlRequest
from ds4_crawl.parity import parity_manifest


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"url": "https://example.test", "urls": ["https://example.test/2"]},
        {"urls": []},
    ],
)
def test_crawl_request_requires_exactly_one_nonempty_url_source(payload) -> None:
    with pytest.raises(ValidationError):
        CrawlRequest.model_validate(payload)


def test_crawl_request_forbids_unknown_top_level_fields() -> None:
    with pytest.raises(ValidationError) as error:
        CrawlRequest.model_validate({"url": "https://example.test", "surprise": True})

    assert error.value.errors()[0]["loc"] == ("surprise",)


def test_unknown_config_field_reports_full_path() -> None:
    with pytest.raises(ConfigPathError) as error:
        build_crawler_config({"bad": True})

    assert error.value.path == "crawler_config.bad"


def test_tagged_values_are_converted_recursively() -> None:
    browser = build_browser_config(
        {
            "proxy_config": {
                "type": "ProxyConfig",
                "params": {"server": "http://127.0.0.1:8080"},
            }
        }
    )
    crawler = build_crawler_config(
        {
            "cache_mode": {"type": "CacheMode", "params": "enabled"},
            "deep_crawl_strategy": {
                "type": "BFSDeepCrawlStrategy",
                "params": {"max_depth": 2},
            },
            "fallback_fetch_function": {
                "type": "extension",
                "params": {"name": "demo:fetch"},
            },
        }
    )

    assert isinstance(browser.proxy_config, ProxyConfig)
    assert crawler.cache_mode is CacheMode.ENABLED
    assert isinstance(crawler.deep_crawl_strategy, BFSDeepCrawlStrategy)
    assert crawler.fallback_fetch_function == ExtensionReference("demo:fetch")


def test_unknown_tag_is_rejected_with_its_path() -> None:
    with pytest.raises(ConfigPathError) as error:
        build_crawler_config(
            {"extraction_strategy": {"type": "NotARealStrategy", "params": {}}}
        )

    assert error.value.path == "crawler_config.extraction_strategy.type"


def test_bearer_auth_always_uses_constant_time_comparison(monkeypatch) -> None:
    calls: list[tuple[bytes, bytes]] = []

    def compare(left: bytes, right: bytes) -> bool:
        calls.append((left, right))
        return hmac.compare_digest(left, right)

    monkeypatch.setattr(auth, "compare_digest", compare)

    with pytest.raises(HTTPException) as error:
        auth.verify_bearer("Bearer wrong", "expected-token")

    assert error.value.status_code == 401
    assert calls == [(b"wrong", b"expected-token")]
    auth.verify_bearer("Bearer expected-token", "expected-token")


def test_parity_covers_every_public_constructor_field() -> None:
    manifest = parity_manifest()

    assert manifest["crawl4ai_version"] == "0.9.0"
    assert manifest["missing_browser_fields"] == []
    assert manifest["missing_crawler_fields"] == []
