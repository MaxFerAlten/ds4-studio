"""Post-selection non-regression gate (plan §21, §32.2).

Upstream `selection_pool()` never contains the baseline; this gate reintroduces it.
Any doubt resolves to the baseline: failure, timeout, mismatch or thin evidence never
promotes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import StrEnum


class Decision(StrEnum):
    KEEP_BASE = 'KEEP_BASE'
    QUARANTINE = 'QUARANTINE_CANDIDATE'
    INCONCLUSIVE = 'INCONCLUSIVE'
    REJECT_SECURITY = 'REJECTED_SECURITY'


@dataclass(frozen=True)
class Scores:
    pass_rate: float
    quality: float
    input_tokens: int
    output_tokens: int
    hard_failures: int
    security_violations: int
    critical_regressions: int
    score_count: int
    profile_digest: str
    evaluator_digest: str
    usage_source: str = 'provider'
    reasons: tuple[str, ...] = field(default=())

    def validate(self) -> None:
        for name in ('pass_rate', 'quality'):
            v = getattr(self, name)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) \
                    or not 0.0 <= v <= 1.0:
                raise ValueError(f'{name} must be a finite number in [0, 1]')
        for name in ('input_tokens', 'output_tokens', 'hard_failures', 'security_violations',
                     'critical_regressions', 'score_count'):
            v = getattr(self, name)
            if isinstance(v, bool) or not isinstance(v, int) or v < 0:
                raise ValueError(f'{name} must be a non-negative integer')


@dataclass(frozen=True)
class GateResult:
    decision: Decision
    reason: str

    def to_dict(self) -> dict:
        return {'decision': str(self.decision), 'reason': self.reason}


def decide(base: Scores, cand: Scores, *, min_gain: float, tolerance: float = 0.0,
           max_token_ratio: float = 2.0, min_scores: int = 1) -> GateResult:
    try:
        base.validate()
        cand.validate()
    except ValueError as e:
        return GateResult(Decision.INCONCLUSIVE, f'invalid scores: {e}')
    if cand.security_violations:
        return GateResult(Decision.REJECT_SECURITY, 'candidate violated a hard security policy')
    if base.profile_digest != cand.profile_digest:
        return GateResult(Decision.INCONCLUSIVE, 'model profile mismatch')
    if base.evaluator_digest != cand.evaluator_digest:
        return GateResult(Decision.INCONCLUSIVE, 'evaluator mismatch')
    if cand.hard_failures or cand.critical_regressions:
        return GateResult(Decision.KEEP_BASE, 'candidate failed required checks')
    if base.score_count < min_scores or cand.score_count < min_scores:
        return GateResult(Decision.INCONCLUSIVE, 'not enough scored runs')
    if cand.pass_rate < base.pass_rate - tolerance:
        return GateResult(Decision.KEEP_BASE, 'candidate pass rate below baseline')
    if cand.quality - base.quality < min_gain:
        return GateResult(Decision.KEEP_BASE, 'quality gain below the predeclared minimum')
    base_t = base.input_tokens + base.output_tokens
    cand_t = cand.input_tokens + cand.output_tokens
    if 'unknown' in (base.usage_source, cand.usage_source):
        return GateResult(Decision.INCONCLUSIVE, 'token usage unknown')
    if base_t == 0 and cand_t == 0 and base.usage_source == cand.usage_source == 'none':
        pass  # deterministic executor: no model tokens on either side
    elif base_t == 0 or cand_t == 0:
        return GateResult(Decision.INCONCLUSIVE, 'token usage missing on one side')
    elif cand_t / base_t > max_token_ratio:
        return GateResult(Decision.KEEP_BASE, 'candidate token cost above the allowed ratio')
    return GateResult(Decision.QUARANTINE, 'candidate beats baseline on every gate')
