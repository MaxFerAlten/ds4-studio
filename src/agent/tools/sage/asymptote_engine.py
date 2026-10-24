"""Asymptote engine: vertical, horizontal, and oblique asymptote detection."""
from typing import Any, Optional
from .models import Asymptote


def classify_asymptotes(
    expression: str,
    variable: str,
    domain_exclusions: list[float],
    limit_evaluator: Any,  # type: ignore[type-arg]  # noqa: F821
) -> list[Asymptote]:
    """Detect vertical, horizontal, and oblique asymptotes.

    Uses Sage for limit computation.
    Returns a list of structured Asymptote objects.
    """
    asymptotes: list[Asymptote] = []

    # Vertical asymptotes: check each exclusion point
    for pt in domain_exclusions:
        left_limit = _compute_limit(expression, variable, pt, -1, limit_evaluator)
        right_limit = _compute_limit(expression, variable, pt, +1, limit_evaluator)

        if _is_infinite(left_limit) or _is_infinite(right_limit):
            asymptotes.append(Asymptote(
                kind="vertical",
                equation=f"x = {pt}",
                direction=None,
                verification_limits=[
                    {"side": "left", "value": left_limit},
                    {"side": "right", "value": right_limit},
                ],
                relative_position=[],
            ))

    # Horizontal asymptotes: limits at ±∞
    for direction_name, sign in [("negative", -1), ("positive", +1)]:
        lim_val = _compute_limit_at_infinity(expression, variable, sign, limit_evaluator)
        if lim_val is not None and not _is_infinite(lim_val):
            asymptotes.append(Asymptote(
                kind="horizontal",
                equation=f"y = {lim_val}",
                direction=direction_name,
                verification_limits=[{"direction": direction_name, "value": lim_val}],
                relative_position=[],
            ))

    # Oblique asymptotes: compute m = lim f(x)/x, q = lim (f(x)-m*x)
    for direction_name, sign in [("negative", -1), ("positive", +1)]:
        m = _compute_slope(expression, variable, sign, limit_evaluator)
        if m is not None and abs(m) > 1e-12 and not _is_infinite(m):
            q = _compute_intercept(expression, variable, m, sign, limit_evaluator)
            if q is not None and not _is_infinite(q):
                asymptotes.append(Asymptote(
                    kind="oblique",
                    equation=f"y = {m}x {'+' if q >= 0 else '-'} {abs(q)}",
                    direction=direction_name,
                    verification_limits=[
                        {"direction": direction_name, "slope": m, "intercept": q},
                    ],
                    relative_position=[],
                ))

    return asymptotes


def _compute_limit(expr: str, var: str, pt: float, side: int, evaluator: Any) -> Optional[float]:  # type: ignore[type-arg]  # noqa: F821
    """Compute one-sided limit using Sage."""
    # Placeholder — real implementation calls Sage via executor
    return None


def _compute_limit_at_infinity(expr: str, var: str, sign: int, evaluator: Any) -> Optional[float]:  # type: ignore[type-arg]  # noqa: F821
    """Compute limit at ±∞."""
    return None


def _compute_slope(expr: str, var: str, sign: int, evaluator: Any) -> Optional[float]:  # type: ignore[type-arg]  # noqa: F821
    """Compute m = lim f(x)/x for oblique asymptote."""
    return None


def _compute_intercept(expr: str, var: str, slope: float, sign: int, evaluator: Any) -> Optional[float]:  # type: ignore[type-arg]  # noqa: F821
    """Compute q = lim (f(x)-m*x) for oblique asymptote."""
    return None


def _is_infinite(val: Optional[float]) -> bool:
    if val is None:
        return False
    import math
    return math.isinf(val)
