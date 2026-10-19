"""Stable reason codes (plan §12.1) and CLI exit codes (plan §29)."""

from __future__ import annotations

from enum import IntEnum, StrEnum


class Code(StrEnum):
    INVALID_INPUT = 'INVALID_INPUT'
    BAD_PROTOCOL = 'BAD_PROTOCOL'
    UNAUTHORIZED = 'UNAUTHORIZED'
    FORBIDDEN = 'FORBIDDEN'
    NOT_FOUND = 'NOT_FOUND'
    NOT_SUPPORTED = 'NOT_SUPPORTED'
    METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED'
    CONFLICT = 'CONFLICT'
    TOO_LARGE = 'TOO_LARGE'
    RATE_LIMITED = 'RATE_LIMITED'
    POLICY_DENIED = 'POLICY_DENIED'
    BUDGET_EXCEEDED = 'BUDGET_EXCEEDED'
    MODEL_BUSY = 'MODEL_BUSY'
    CAPABILITY_MISSING = 'CAPABILITY_MISSING'
    SANDBOX_UNAVAILABLE = 'SANDBOX_UNAVAILABLE'
    UPSTREAM_UNAVAILABLE = 'UPSTREAM_UNAVAILABLE'
    DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED'
    PROFILE_MISMATCH = 'PROFILE_MISMATCH'
    PROTOCOL_ERROR = 'PROTOCOL_ERROR'
    INTEGRITY_FAILURE = 'INTEGRITY_FAILURE'
    BLOCKED_API = 'BLOCKED_API'
    INTERNAL_ERROR = 'INTERNAL_ERROR'


HTTP_STATUS: dict[Code, int] = {
    Code.INVALID_INPUT: 400,
    Code.BAD_PROTOCOL: 426,
    Code.UNAUTHORIZED: 401,
    Code.FORBIDDEN: 403,
    Code.NOT_FOUND: 404,
    Code.NOT_SUPPORTED: 404,
    Code.METHOD_NOT_ALLOWED: 405,
    Code.CONFLICT: 409,
    Code.TOO_LARGE: 413,
    Code.RATE_LIMITED: 429,
    Code.POLICY_DENIED: 422,
    Code.BUDGET_EXCEEDED: 429,
    Code.MODEL_BUSY: 503,
    Code.CAPABILITY_MISSING: 501,
    Code.SANDBOX_UNAVAILABLE: 503,
    Code.UPSTREAM_UNAVAILABLE: 503,
    Code.DEADLINE_EXCEEDED: 504,
    Code.PROFILE_MISMATCH: 409,
    Code.PROTOCOL_ERROR: 502,
    Code.INTEGRITY_FAILURE: 500,
    Code.BLOCKED_API: 501,
    Code.INTERNAL_ERROR: 500,
}


class Exit(IntEnum):
    OK = 0
    INVALID_ARGS = 2
    CAPABILITY_MISSING = 3
    POLICY_BLOCKED = 4
    RESOURCE_BUSY = 5
    EXPERIMENT_FAILED = 6
    INTEGRITY_FAILURE = 7
    INTERNAL = 10


EXIT_FOR_CODE: dict[Code, Exit] = {
    Code.INVALID_INPUT: Exit.INVALID_ARGS,
    Code.CAPABILITY_MISSING: Exit.CAPABILITY_MISSING,
    Code.BLOCKED_API: Exit.CAPABILITY_MISSING,
    Code.SANDBOX_UNAVAILABLE: Exit.CAPABILITY_MISSING,
    Code.UPSTREAM_UNAVAILABLE: Exit.CAPABILITY_MISSING,
    Code.POLICY_DENIED: Exit.POLICY_BLOCKED,
    Code.FORBIDDEN: Exit.POLICY_BLOCKED,
    Code.UNAUTHORIZED: Exit.POLICY_BLOCKED,
    Code.MODEL_BUSY: Exit.RESOURCE_BUSY,
    Code.RATE_LIMITED: Exit.RESOURCE_BUSY,
    Code.CONFLICT: Exit.RESOURCE_BUSY,
    Code.INTEGRITY_FAILURE: Exit.INTEGRITY_FAILURE,
}


class H2DS4Error(Exception):
    """An error carrying a stable reason code. `detail` must never hold paths or payloads."""

    def __init__(self, code: Code, detail: str = '') -> None:
        super().__init__(f'{code}: {detail}' if detail else str(code))
        self.code = code
        self.detail = detail

    @property
    def http_status(self) -> int:
        return HTTP_STATUS[self.code]

    @property
    def exit_code(self) -> int:
        return int(EXIT_FOR_CODE.get(self.code, Exit.INTERNAL))

    def body(self) -> dict[str, str]:
        out = {'error': str(self.code)}
        if self.detail:
            out['detail'] = self.detail[:300]
        return out
