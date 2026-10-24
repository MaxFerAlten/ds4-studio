"""Concavity engine: compute intervals and classification from f'' signs."""
from typing import Any
from .models import SignValue, ConcavityInterval
from .sign_engine import compute_sign_intervals


def build_concavity_intervals(
    second_derivative_expr: str,
    variable: str,
    zeros: list[float],
    domain_exclusions: list[float],
    evaluator: Any,
) -> list[ConcavityInterval]:
    """Compute concavity intervals using the sign engine on f''.

    Returns structured intervals with convex/concave classification.
    """
    sign_intervals = compute_sign_intervals(
        expression=second_derivative_expr,
        variable=variable,
        zeros=zeros,
        domain_exclusions=domain_exclusions,
        evaluator=evaluator,
    )

    results: list[ConcavityInterval] = []
    for si in sign_intervals:
        if si.sign == SignValue.POSITIVE:
            classification = "convex"
        elif si.sign == SignValue.NEGATIVE:
            classification = "concave"
        else:
            classification = "unknown"

        results.append(ConcavityInterval(
            interval=si.interval,
            second_derivative_sign=si.sign,
            classification=classification,
        ))

    return results


def classify_inflection_point(
    x0: float,
    excluded_points: list[str],
    left_second_derivative_sign: SignValue,
    right_second_derivative_sign: SignValue,
    y_value: float | None,
) -> bool:
    """Determine if x0 is a genuine inflection point.

    Requirements:
    1. x0 belongs to the domain (not excluded)
    2. The function is continuous at x0
    3. f'' changes sign across x0
    4. y = f(x0) is computable
    """
    # Check exclusion
    for excl in excluded_points:
        try:
            if abs(float(excl) - x0) < 1e-12:
                return False
        except (ValueError, TypeError):
            pass

    if y_value is None:
        return False

    # Must have a real sign change (POSITIVE ↔ NEGATIVE)
    return (
        left_second_derivative_sign != right_second_derivative_sign
        and left_second_derivative_sign in {SignValue.POSITIVE, SignValue.NEGATIVE}
        and right_second_derivative_sign in {SignValue.POSITIVE, SignValue.NEGATIVE}
    )
