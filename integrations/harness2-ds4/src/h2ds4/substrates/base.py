"""The executor contract every h2ds4 substrate implements."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from ..fixtures import TaskFixture
from ..model.proxy import ProxyContext
from ..sandbox.bwrap import SandboxResult


@dataclass
class ExecutionResult:
    run_id: str
    sandbox: SandboxResult
    events: list[dict]
    usage: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.sandbox.timed_out and self.sandbox.returncode == 0


class Substrate(Protocol):
    name: str

    def preflight(self) -> dict:
        """{'ready': bool, 'blockers': [...], ...}; never starts any model."""

    def execute(self, fixture: TaskFixture, harness: dict[str, bytes], run_id: str, *,
                proxy: ProxyContext | None) -> ExecutionResult:
        ...
