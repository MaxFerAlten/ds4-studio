from __future__ import annotations

import inspect
from dataclasses import dataclass
from enum import Enum
from importlib.metadata import version
from typing import Any

import crawl4ai
from crawl4ai import BrowserConfig, CrawlerRunConfig
from crawl4ai.async_configs import ALLOWED_DESERIALIZE_TYPES


PINNED_CRAWL4AI_VERSION = "0.9.0"


class ConfigPathError(ValueError):
    def __init__(self, path: str, message: str):
        self.path = path
        super().__init__(f"{path}: {message}")


@dataclass(frozen=True, slots=True)
class ExtensionReference:
    name: str


def public_constructor_fields(cls: type[Any]) -> frozenset[str]:
    return frozenset(
        name
        for name, parameter in inspect.signature(cls).parameters.items()
        if not name.startswith("_")
        and parameter.kind
        not in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
    )


def _reject_unknown_fields(
    values: dict[str, Any], cls: type[Any], path: str
) -> None:
    supported = public_constructor_fields(cls)
    for name in values:
        if name not in supported:
            raise ConfigPathError(f"{path}.{name}", "unknown field")


def _tagged_class(type_name: str, path: str) -> type[Any]:
    if type_name not in ALLOWED_DESERIALIZE_TYPES:
        raise ConfigPathError(path, f"unknown or unsupported type {type_name!r}")
    cls = getattr(crawl4ai, type_name, None)
    if not inspect.isclass(cls):
        raise ConfigPathError(path, f"type {type_name!r} is not exported by Crawl4AI")
    return cls


def _convert_tagged(value: dict[str, Any], path: str) -> Any:
    type_name = value.get("type")
    if not isinstance(type_name, str) or not type_name:
        raise ConfigPathError(f"{path}.type", "must be a non-empty string")

    if type_name == "extension":
        params = value.get("params")
        if not isinstance(params, dict) or set(params) != {"name"}:
            raise ConfigPathError(
                f"{path}.params", "extension params must contain only name"
            )
        name = params["name"]
        if not isinstance(name, str) or not name.strip():
            raise ConfigPathError(f"{path}.params.name", "must be a non-empty string")
        return ExtensionReference(name.strip())

    if type_name == "dict":
        if set(value) != {"type", "value"} or not isinstance(value["value"], dict):
            raise ConfigPathError(path, "dict tag requires one mapping value")
        return {
            key: _strict_convert(item, f"{path}.value.{key}")
            for key, item in value["value"].items()
        }

    if set(value) != {"type", "params"}:
        raise ConfigPathError(path, "tagged value requires only type and params")

    cls = _tagged_class(type_name, f"{path}.type")
    params = value["params"]
    if issubclass(cls, Enum):
        try:
            return cls(params)
        except (TypeError, ValueError) as error:
            raise ConfigPathError(f"{path}.params", str(error)) from error

    if not isinstance(params, dict):
        raise ConfigPathError(f"{path}.params", "must be an object")
    _reject_unknown_fields(params, cls, f"{path}.params")
    converted = {
        name: _strict_convert(item, f"{path}.params.{name}")
        for name, item in params.items()
    }
    try:
        return cls(**converted)
    except (TypeError, ValueError) as error:
        raise ConfigPathError(path, str(error)) from error


def _strict_convert(value: Any, path: str) -> Any:
    if isinstance(value, list):
        return [_strict_convert(item, f"{path}[{index}]") for index, item in enumerate(value)]
    if isinstance(value, dict):
        if "type" in value and ("params" in value or "value" in value):
            return _convert_tagged(value, path)
        return {
            key: _strict_convert(item, f"{path}.{key}")
            for key, item in value.items()
        }
    return value


def _build_config(values: dict[str, Any], cls: type[Any], path: str) -> Any:
    if version("crawl4ai") != PINNED_CRAWL4AI_VERSION:
        raise RuntimeError(
            f"expected crawl4ai {PINNED_CRAWL4AI_VERSION}, got {version('crawl4ai')}"
        )
    _reject_unknown_fields(values, cls, path)
    converted = {
        name: _strict_convert(value, f"{path}.{name}")
        for name, value in values.items()
    }
    try:
        return cls(**converted)
    except (TypeError, ValueError) as error:
        raise ConfigPathError(path, str(error)) from error


def build_browser_config(values: dict[str, Any] | None = None) -> BrowserConfig:
    return _build_config(values or {}, BrowserConfig, "browser_config")


def build_crawler_config(values: dict[str, Any] | None = None) -> CrawlerRunConfig:
    return _build_config(values or {}, CrawlerRunConfig, "crawler_config")
