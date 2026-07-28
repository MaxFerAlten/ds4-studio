from __future__ import annotations

from typing import Any


class Ds4ToolBridgeError(RuntimeError):
    """Fail-closed error raised by the private DS4 tool bridge."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int | None = None,
        details: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.details = details
