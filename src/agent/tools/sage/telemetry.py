"""Telemetry for SageMath orchestration V2.

Records structured metrics without sensitive user content.
"""
from typing import Optional
from .models import SageRequest, SageExecutionResult


class SageTelemetry:
    """Collects and exposes Sage orchestration metrics."""

    def __init__(self):
        self._metrics: dict[str, int] = {
            "sage.requests.total": 0,
            "sage.requests.function_study": 0,
            "sage.execution.success": 0,
            "sage.execution.failure": 0,
            "sage.execution.timeout": 0,
            "sage.repair.used": 0,
            "sage.repair.success": 0,
            "sage.validation.math.failure": 0,
            "sage.validation.katex.failure": 0,
            "sage.plot.failure": 0,
            "sage.quality_gate.failure": 0,
            "sage.final.success": 0,
        }
        self._executions: list[dict] = []

    def record_request(self, request: SageRequest) -> None:
        self._metrics["sage.requests.total"] += 1
        if request.task_type.value == "function_study":
            self._metrics["sage.requests.function_study"] += 1

    def record_execution(
        self,
        request: Optional[SageRequest] = None,
        execution: Optional[SageExecutionResult] = None,
    ) -> None:
        if execution is None:
            return

        if execution.ok:
            self._metrics["sage.execution.success"] += 1
        else:
            self._metrics["sage.execution.failure"] += 1

        if execution.timed_out:
            self._metrics["sage.execution.timeout"] += 1

        # Store minimal metadata (no user content)
        entry = {
            "attempt": execution.attempt,
            "ok": execution.ok,
            "duration_ms": execution.duration_ms,
            "timed_out": execution.timed_out,
            "exit_code": execution.exit_code,
        }
        self._executions.append(entry)

    def record_repair(self, used: bool, success: bool) -> None:
        if used:
            self._metrics["sage.repair.used"] += 1
        if success:
            self._metrics["sage.repair.success"] += 1

    def record_validation_failure(self, kind: str) -> None:
        if kind == "math":
            self._metrics["sage.validation.math.failure"] += 1
        elif kind == "katex":
            self._metrics["sage.validation.katex.failure"] += 1

    def record_plot_failure(self) -> None:
        self._metrics["sage.plot.failure"] += 1

    def record_quality_gate_failure(self) -> None:
        self._metrics["sage.quality_gate.failure"] += 1

    def record_final_success(self) -> None:
        self._metrics["sage.final.success"] += 1

    @property
    def metrics(self) -> dict[str, int]:
        return dict(self._metrics)

    def summary(self) -> str:
        """Return a compact human-readable summary."""
        m = self._metrics
        total = m.get("sage.requests.total", 0)
        success = m.get("sage.execution.success", 0)
        failure = m.get("sage.execution.failure", 0)

        parts = [
            f"Sage calls: {total}",
            f"Executions: {success} ok / {failure} fail",
        ]

        timeout_count = m.get("sage.execution.timeout", 0)
        if timeout_count:
            parts.append(f"Timeouts: {timeout_count}")

        qgf = m.get("sage.quality_gate.failure", 0)
        if qgf:
            parts.append(f"Quality gate blocks: {qgf}")

        return " | ".join(parts)
