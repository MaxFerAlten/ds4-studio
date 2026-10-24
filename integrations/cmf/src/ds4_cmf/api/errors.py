"""Public error codes (plan §7.3, docs/M1-acceptance.md "API minima").

Messages are fixed per code: nothing from the request, the store or another
scope ever reaches a client or a log through an error.
"""

from __future__ import annotations

STATUS = {
    "SCHEMA": 400,
    "AUTH_REQUIRED": 401,
    "SCOPE": 403,
    "NOT_VISIBLE": 404,
    "METHOD": 405,
    "IDEMPOTENCY_CONFLICT": 409,
    "VERSION_CONFLICT": 409,
    "LIMIT": 413,
    "BUDGET": 429,
    "INTERNAL": 500,
    "DEGRADED": 503,
    "SOURCE_UNAVAILABLE": 503,
    "DEADLINE": 504,
}

MESSAGE = {
    "SCHEMA": "invalid request",
    "AUTH_REQUIRED": "authentication required",
    "SCOPE": "operation not permitted",
    "NOT_VISIBLE": "not found",
    "METHOD": "method not allowed",
    "IDEMPOTENCY_CONFLICT": "event_key reused with a different request",
    "VERSION_CONFLICT": "incompatible schema version",
    "LIMIT": "size limit exceeded",
    "BUDGET": "capacity exhausted",
    "INTERNAL": "internal error",
    "DEGRADED": "store unavailable",
    "SOURCE_UNAVAILABLE": "source unavailable",
    "DEADLINE": "deadline exceeded",
}


class CmfError(Exception):
    """An error with a public code.  `detail` is for operators only: it goes
    to the CLI's stderr for offline admin commands, never over the socket."""

    def __init__(self, code: str, detail: str = ""):
        if code not in STATUS:
            code = "INTERNAL"
        super().__init__(code)
        self.code = code
        self.status = STATUS[code]
        self.detail = detail

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": MESSAGE[self.code]}}
