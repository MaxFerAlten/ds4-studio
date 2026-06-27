from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest
from pydantic import BaseModel

from ds4_crawl.plugins import PluginReferenceError, PluginResolver
from ds4_crawl.serialize import ArtifactCandidate, serialize_result


def test_configured_plugin_entrypoint_resolves(monkeypatch, tmp_path: Path) -> None:
    (tmp_path / "demo_plugin.py").write_text(
        "def hook(value):\n    return f'hooked:{value}'\n",
        encoding="utf-8",
    )
    monkeypatch.syspath_prepend(tmp_path)
    resolver = PluginResolver(
        modules={"demo": "demo_plugin"},
        roots=[tmp_path],
    )

    hook = resolver.resolve("demo:hook")

    assert hook("value") == "hooked:value"


def test_request_cannot_resolve_arbitrary_python_path(tmp_path: Path) -> None:
    resolver = PluginResolver(modules={"demo": "demo_plugin"}, roots=[tmp_path])

    with pytest.raises(PluginReferenceError):
        resolver.resolve("/tmp/x.py:hook")


class FutureResult:
    def __init__(self) -> None:
        self.url = "https://example.test"
        self.future_upstream_field = {"score": 0.75}


class ResultModel(BaseModel):
    title: str


@dataclass
class ResultEnvelope:
    model: ResultModel
    upstream: FutureResult
    body: bytes


def test_serializer_preserves_unknown_object_fields_and_marks_bytes() -> None:
    serialized = serialize_result(
        ResultEnvelope(
            model=ResultModel(title="Example"),
            upstream=FutureResult(),
            body=b"\x00crawl\xff",
        )
    )

    assert serialized["model"] == {"title": "Example"}
    assert serialized["upstream"] == {
        "url": "https://example.test",
        "future_upstream_field": {"score": 0.75},
    }
    assert serialized["body"] == ArtifactCandidate(data=b"\x00crawl\xff")
