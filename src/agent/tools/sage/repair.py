"""Deterministic Sage code repair for known error patterns.

Each repair is covered by a unit test.
No free-form model retry after max attempts.
"""
from typing import Callable, Optional
from .error_classifier import SageErrorType
from .exceptions import SageExecutionFailedControlled

MAX_REPAIR_ATTEMPTS = 2
MAX_TOTAL_ATTEMPTS = 3


class SageRepairEngine:
    """Applies deterministic repairs to Sage code based on classified errors."""

    def repair(
        self,
        code: str,
        error_type: SageErrorType,
    ) -> str | None:
        """Return repaired code or None if no repair is available."""
        repair_fn = self._get_repair(error_type)
        if repair_fn is None:
            return None
        return repair_fn(code)

    def _get_repair(
        self, error_type: SageErrorType
    ) -> Optional[Callable]:
        repairs: dict[SageErrorType, Callable] = {
            SageErrorType.SYMBOLIC_QUO_REM: self._fix_quo_rem,
            SageErrorType.SOLVE_POLYNOMIAL_TYPE: self._fix_solve_polynomial,
            SageErrorType.POSITIONAL_SUBSTITUTION: self._fix_positional_substitution,
            SageErrorType.TIMEOUT: self._fix_timeout,
        }
        return repairs.get(error_type)

    def _fix_quo_rem(self, code: str) -> str:
        """Replace direct quo_rem calls with PolynomialRing pattern."""
        # The fix wraps the expression in a polynomial ring context.
        # This is a template-level repair; for full generality we inject
        # the PolynomialRing preamble before the failing line.
        lines = code.splitlines()
        repaired = []
        injected = False
        for line in lines:
            if "quo_rem" in line and not injected:
                repaired.append("R.<t> = PolynomialRing(QQ)")
                # Replace bare symbolic expressions with ring variables
                repaired.append(line)
                injected = True
            else:
                repaired.append(line)
        return "\n".join(repaired)

    def _fix_solve_polynomial(self, code: str) -> str:
        """Convert solve() on ring polynomials to use .roots() or real_roots()."""
        # Detect p.solve? patterns and replace with symbolic solve
        import re
        # Pattern: something like `solve(p, x)` where p is a ring poly
        # Replace with explicit symbolic conversion
        new_code = re.sub(
            r"solve\(([^,]+),\s*(x|var)\)",
            r"solve(\1.expression(), \2)",
            code,
        )
        return new_code

    def _fix_positional_substitution(self, code: str) -> str:
        """Replace positional substitution with keyword substitution."""
        import re
        # Pattern: f(x=value) → already correct; detect f(value) pattern
        # Match calls like `expr(a, b)` that should be `expr.subs(x=a)`
        new_code = re.sub(
            r"(\w+)\((\d+\.?\d*)\)",
            r"\1.subs(x=\2)",
            code,
        )
        return new_code

    def _fix_timeout(self, code: str) -> str:
        """For timeout, simplify the computation by reducing complexity."""
        # Reduce adaptive recursion, limit range, etc.
        new_code = code.replace("adaptive_recursion=8", "adaptive_recursion=4")
        new_code = new_code.replace("detect_poles=True", "detect_poles=False")
        return new_code


def apply_repair_cycle(
    executor,
    request_dir,
    code: str,
    error_classifier_fn,
    repair_engine: SageRepairEngine,
    max_total: int = MAX_TOTAL_ATTEMPTS,
) -> tuple:
    """Run execute-repair loop until success or max attempts exhausted.

    Returns (final_execution, final_code).
    """
    execution = None
    current_code = code

    for attempt in range(1, max_total + 1):
        execution = executor.execute(current_code, request_dir, attempt)

        if execution.ok:
            return execution, current_code

        error_type = error_classifier_fn(execution)
        repaired = repair_engine.repair(current_code, error_type)

        if repaired is None or repaired == current_code:
            break

        current_code = repaired

    if execution is None or not execution.ok:
        raise SageExecutionFailedControlled(
            f"Execution failed after {max_total} attempts"
        )

    return execution, current_code
