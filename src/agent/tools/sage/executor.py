"""Isolated SageMath executor with timeout and structured result capture."""
import subprocess
from pathlib import Path
from time import monotonic

from .models import SageExecutionResult


class SageExecutor:
    """Executes Sage code in an isolated process with timeout controls."""

    def __init__(
        self,
        sage_binary: str = "sage",
        timeout_seconds: int = 30,
        max_output_chars: int = 200_000,
    ):
        self.sage_binary = sage_binary
        self.timeout_seconds = timeout_seconds
        self.max_output_chars = max_output_chars

    def _safe_environment(self) -> dict[str, str]:
        """Return a minimal environment without network or user access."""
        env = {
            "HOME": "/tmp",
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "SAGE_ROOT": "",
            "SAGE_LOCAL": "",
        }
        return env

    def execute(
        self,
        code: str,
        request_dir: Path,
        attempt: int = 1,
    ) -> SageExecutionResult:
        """Write code to file, run Sage, return structured result."""
        script_path = request_dir / "input.sage"
        script_path.write_text(code, encoding="utf-8")

        started = monotonic()

        try:
            completed = subprocess.run(
                [self.sage_binary, str(script_path)],
                cwd=request_dir,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
                env=self._safe_environment(),
            )

            duration_ms = int((monotonic() - started) * 1000)

            stdout = completed.stdout[: self.max_output_chars]
            stderr = completed.stderr[: self.max_output_chars]

            return SageExecutionResult(
                ok=completed.returncode == 0,
                exit_code=completed.returncode,
                stdout=stdout,
                stderr=stderr,
                duration_ms=duration_ms,
                timed_out=False,
                code_path=str(script_path),
                attempt=attempt,
            )

        except subprocess.TimeoutExpired as exc:
            duration_ms = int((monotonic() - started) * 1000)

            return SageExecutionResult(
                ok=False,
                exit_code=-1,
                stdout=(exc.stdout or "")[: self.max_output_chars],
                stderr=(exc.stderr or "")[: self.max_output_chars],
                duration_ms=duration_ms,
                timed_out=True,
                code_path=str(script_path),
                attempt=attempt,
            )
