from __future__ import annotations

from importlib.metadata import version

from crawl4ai import BrowserConfig, CrawlerRunConfig

from .adapter import public_constructor_fields


def parity_manifest() -> dict[str, object]:
    browser_fields = public_constructor_fields(BrowserConfig)
    crawler_fields = public_constructor_fields(CrawlerRunConfig)
    accepted_browser_fields = public_constructor_fields(BrowserConfig)
    accepted_crawler_fields = public_constructor_fields(CrawlerRunConfig)
    return {
        "crawl4ai_version": version("crawl4ai"),
        "browser_fields": sorted(browser_fields),
        "crawler_fields": sorted(crawler_fields),
        "missing_browser_fields": sorted(browser_fields - accepted_browser_fields),
        "missing_crawler_fields": sorted(crawler_fields - accepted_crawler_fields),
    }
