"""Immutable request/record types (plan §12, §14.1, §15.2, §30.3)."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .canonical import DIGEST_RE, digest_obj

_ID = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$')


def safe_id(value: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError('invalid id')
    return value


class ExperimentCreate(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, strict=True)

    schema_version: Literal[1] = 1
    task_id: str = Field(min_length=1, max_length=80)
    task_family: str = Field(min_length=1, max_length=80)
    mode: Literal['lab', 'propose']
    substrate: Literal['opencode_local', 'ds4_native', 'scripted_local']
    workspace_fixture_id: str
    baseline_harness_id: str
    model_profile_id: str
    evaluation_profile_id: str
    k: int = Field(ge=1, le=2)
    run_seed: int = Field(ge=0, le=2147483647)

    @field_validator('task_id', 'task_family', 'workspace_fixture_id')
    @classmethod
    def _safe_id(cls, value: str) -> str:
        return safe_id(value)

    @field_validator('baseline_harness_id', 'model_profile_id', 'evaluation_profile_id')
    @classmethod
    def _digest(cls, value: str) -> str:
        if not DIGEST_RE.fullmatch(value):
            raise ValueError('digest must be sha256:<64 lowercase hex>')
        return value


class ApprovalRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, strict=True)

    expected_active_digest: str = Field(min_length=1, max_length=80)
    reason: str = Field(min_length=1, max_length=1000)


class RollbackRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True, strict=True)

    expected_revision: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=1000)


@dataclass(frozen=True)
class ModelProfile:
    """Identity of one local model configuration (plan §3.2). Never aggregated across ids."""

    backend: str
    model_id: str
    gguf_sha256: str
    quantization: str
    ctx_size: int
    tokenizer_id: str
    tool_protocol: str
    runtime_build: str
    sampler_profile: str

    def digest(self) -> str:
        return digest_obj(asdict(self))

    def family(self) -> str:
        return f'{self.backend}/{self.model_id}/{self.quantization}/{self.tool_protocol}'


@dataclass(frozen=True)
class RunEnvelope:
    experiment_id: str
    task_fixture_id: str
    execution_id: str
    substrate: Literal['opencode_local', 'ds4_native', 'scripted_local']
    model_profile_id: str
    base_harness_digest: str
    candidate_harness_digest: str
    evaluator_digest: str
    source_digest: str
    attempt: int
    seed: int
    hard_deadline_utc: str
    max_model_calls: int
    max_input_tokens: int
    max_output_tokens: int
    max_tool_calls: int
    max_workspace_bytes: int
    isolation_profile_id: str

    def __post_init__(self) -> None:
        if self.attempt < 1:
            raise ValueError('attempt must be >= 1')
        for name in ('model_profile_id', 'base_harness_digest', 'candidate_harness_digest',
                     'evaluator_digest', 'source_digest'):
            if not DIGEST_RE.fullmatch(getattr(self, name)):
                raise ValueError(f'{name} must be a sha256 digest')

    def digest(self) -> str:
        return digest_obj(asdict(self))


@dataclass(frozen=True)
class ModelCapabilities:
    chat: bool
    tools: bool
    streaming: bool
    token_count: bool
    cancel: bool
    stable_usage: bool
    context_size: int | None
    model_id: str
    backend_label: str
    version_digest: str


@dataclass(frozen=True)
class Usage:
    input_tokens: int | None
    output_tokens: int | None
    cached_input_tokens: int | None
    source: Literal['provider', 'tokenizer', 'estimated', 'unknown']


@dataclass(frozen=True)
class NormalizedModelResponse:
    content: str
    tool_calls: tuple[dict, ...]
    finish_reason: str | None
    usage: Usage
    raw_digest: str
    model: str
