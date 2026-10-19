"""Budgets enforced outside the agent (plan §18.3, §20.3, §31.5)."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from time import monotonic

from ..errors import Code, H2DS4Error

SELECTION_POLICIES = ('trivial', 'selector')


def estimate(k: int, *, selection_policy: str = 'trivial', reflection_enabled: bool = True,
             max_attempts: int = 2) -> dict:
    """Upper bound on model sessions for one task before a job is committed."""
    if k not in (1, 2):
        raise H2DS4Error(Code.INVALID_INPUT, 'k must be 1 or 2 in phase 1')
    if selection_policy not in SELECTION_POLICIES:
        raise H2DS4Error(Code.INVALID_INPUT, 'unknown selection policy')
    rollouts = 4 * k
    improvement = 3 * k
    selector = 0 if (k == 1 and selection_policy == 'trivial') else 1
    reflection = 1 if reflection_enabled else 0
    sessions = improvement + selector + reflection
    return {'rollouts': rollouts, 'improvement_sessions': improvement,
            'selector_sessions': selector, 'reflection_sessions': reflection,
            'max_proposer_calls': sessions * max_attempts,
            'max_rollouts_with_retry': rollouts}


@dataclass
class Budget:
    deadline: float
    model_calls_left: int
    tool_calls_left: int
    input_tokens_left: int
    output_tokens_left: int
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    @classmethod
    def from_limits(cls, *, wall_s: float, model_calls: int, tool_calls: int,
                    input_tokens: int, output_tokens: int) -> Budget:
        return cls(monotonic() + wall_s, model_calls, tool_calls, input_tokens, output_tokens)

    def before_model(self, pessimistic_input: int, pessimistic_output: int) -> None:
        if pessimistic_input < 0 or pessimistic_output < 0:
            raise H2DS4Error(Code.INVALID_INPUT, 'negative token estimate')
        with self._lock:
            if monotonic() > self.deadline:
                raise H2DS4Error(Code.DEADLINE_EXCEEDED, 'DEADLINE_EXCEEDED')
            if self.model_calls_left <= 0:
                raise H2DS4Error(Code.BUDGET_EXCEEDED, 'MODEL_CALL_BUDGET')
            if pessimistic_input > self.input_tokens_left:
                raise H2DS4Error(Code.BUDGET_EXCEEDED, 'INPUT_TOKEN_BUDGET')
            if pessimistic_output > self.output_tokens_left:
                raise H2DS4Error(Code.BUDGET_EXCEEDED, 'OUTPUT_TOKEN_BUDGET')
            self.model_calls_left -= 1
            self.input_tokens_left -= pessimistic_input
            self.output_tokens_left -= pessimistic_output

    def before_tool(self) -> None:
        with self._lock:
            if monotonic() > self.deadline or self.tool_calls_left <= 0:
                raise H2DS4Error(Code.BUDGET_EXCEEDED, 'TOOL_BUDGET')
            self.tool_calls_left -= 1

    def remaining_s(self) -> float:
        return max(0.0, self.deadline - monotonic())

    def snapshot(self) -> dict:
        with self._lock:
            return {'remaining_s': round(self.remaining_s(), 1),
                    'model_calls_left': self.model_calls_left,
                    'tool_calls_left': self.tool_calls_left,
                    'input_tokens_left': self.input_tokens_left,
                    'output_tokens_left': self.output_tokens_left}


def estimate_tokens(text: str) -> int:
    """Conservative token estimate (marked `estimated` wherever reported): ~3 chars/token."""
    return max(1, (len(text.encode('utf-8')) + 2) // 3)
