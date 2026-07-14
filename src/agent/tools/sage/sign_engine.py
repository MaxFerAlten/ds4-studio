"""Deterministic sign computation engine for SageMath expressions."""
from typing import Callable, Optional
from .models import SignValue, SignInterval, Interval
from .interval_engine import (
    sort_breakpoints,
    build_connected_intervals,
    split_interval_at_exclusions,
    choose_sample_point,
)

DEFAULT_SIGN_EPSILON = 1e-12


def compute_sign_intervals(
    expression: str,
    variable: str,
    zeros: list[float],
    domain_exclusions: list[float],
    evaluator: Callable[[str, float], float | None],
    epsilon: float = DEFAULT_SIGN_EPSILON,
) -> list[SignInterval]:
    """Compute sign intervals for an expression over its domain.

    1. Collect all breakpoints (zeros + exclusions)
    2. Build connected intervals
    3. Split at exclusion points
    4. Sample each interval and determine sign
    """
    # Merge zeros and exclusions as breakpoints
    breakpoints = sort_breakpoints([], zeros + domain_exclusions)

    # Build base intervals
    raw_intervals = build_connected_intervals(breakpoints)

    # Split each interval at domain exclusions
    refined: list[Interval] = []
    for iv in raw_intervals:
        parts = split_interval_at_exclusions(iv, domain_exclusions)
        refined.extend(parts)

    # Evaluate sign on each refined interval
    results: list[SignInterval] = []
    for iv in refined:
        sample = choose_sample_point(iv)
        if sample is None:
            continue

        value = evaluator(expression, sample)
        sign = _determine_sign(value, epsilon)

        results.append(SignInterval(
            interval=iv,
            sample_point=sample,
            sign=sign,
            evaluated_value=value,
        ))

    return results


def _determine_sign(
    value: float | None,
    epsilon: float,
) -> SignValue:
    """Determine sign from a numeric evaluation."""
    if value is None:
        return SignValue.UNDEFINED

    if abs(value) < epsilon:
        return SignValue.ZERO

    if value > 0:
        return SignValue.POSITIVE

    if value < 0:
        return SignValue.NEGATIVE

    return SignValue.UNKNOWN
