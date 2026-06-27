from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, fields, is_dataclass
from datetime import date, datetime
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel


class ResultSerializationError(TypeError):
    pass


@dataclass(frozen=True, slots=True)
class ArtifactCandidate:
    data: bytes
    media_type: str = "application/octet-stream"


def serialize_result(value: Any) -> Any:
    return _serialize(value, set())


def _serialize(value: Any, active: set[int]) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, ArtifactCandidate):
        return value
    if isinstance(value, (bytes, bytearray, memoryview)):
        return ArtifactCandidate(bytes(value))
    if isinstance(value, Enum):
        return _serialize(value.value, active)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)

    identity = id(value)
    if identity in active:
        raise ResultSerializationError("cyclic result object")
    active.add(identity)
    try:
        if isinstance(value, BaseModel):
            return _serialize(value.model_dump(mode="python"), active)
        if is_dataclass(value) and not isinstance(value, type):
            return {
                field.name: _serialize(getattr(value, field.name), active)
                for field in fields(value)
            }
        if isinstance(value, Mapping):
            return {
                str(key): _serialize(item, active)
                for key, item in value.items()
            }
        if isinstance(value, (list, tuple, set, frozenset)):
            return [_serialize(item, active) for item in value]

        attributes = getattr(value, "__dict__", None)
        if isinstance(attributes, dict):
            public = {
                name: item for name, item in attributes.items() if not name.startswith("_")
            }
            if public:
                return {
                    name: _serialize(item, active) for name, item in public.items()
                }
        raise ResultSerializationError(
            f"unsupported result value of type {type(value).__name__}"
        )
    finally:
        active.remove(identity)
