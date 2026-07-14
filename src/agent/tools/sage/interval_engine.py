"""Interval engine: breakpoints, connected components, splitting at exclusions."""
from typing import Any, Optional
from .models import Bound, Interval


def sort_breakpoints(
    exact_points: list[str],
    numeric_points: list[float],
) -> list[float]:
    """Merge and sort all breakpoints into a single ordered float list.

    Exact points that are parseable as floats are included.
    """
    merged = set()
    for p in exact_points:
        try:
            merged.add(float(p))
        except (ValueError, TypeError):
            pass
    for p in numeric_points:
        merged.add(p)

    return sorted(merged)


def build_connected_intervals(
    breakpoints: list[float],
    negative_infinity: bool = True,
    positive_infinity: bool = True,
) -> list[Interval]:
    """Build intervals between consecutive breakpoints.

    Returns open intervals by default. Adds -∞ and +∞ bounds when requested.
    """
    if not breakpoints:
        # Single unbounded interval
        left_bound = Bound(is_infinite=True, is_positive_infinity=False)
        right_bound = Bound(is_infinite=True, is_positive_infinity=True)
        return [Interval(left=left_bound, right=right_bound)]

    intervals: list[Interval] = []
    sorted_bps = sorted(set(breakpoints))

    # Leftmost segment
    if negative_infinity:
        intervals.append(Interval(
            left=Bound(is_infinite=True, is_positive_infinity=False),
            right=Bound(value=sorted_bps[0]),
        ))

    # Middle segments
    for i in range(len(sorted_bps) - 1):
        intervals.append(Interval(
            left=Bound(value=sorted_bps[i]),
            right=Bound(value=sorted_bps[i + 1]),
        ))

    # Rightmost segment
    if positive_infinity:
        intervals.append(Interval(
            left=Bound(value=sorted_bps[-1]),
            right=Bound(is_infinite=True, is_positive_infinity=True),
        ))

    return intervals


def split_interval_at_exclusions(
    interval: Interval,
    exclusions: list[float],
) -> list[Interval]:
    """Split an interval at each exclusion point that falls inside it.

    Returns a list of sub-intervals with the excluded points as boundaries.
    """
    result: list[Interval] = [interval]
    for excl in sorted(exclusions):
        new_parts: list[Interval] = []
        for part in result:
            lo = _bound_value(part.left)
            hi = _bound_value(part.right)

            # Check if exclusion lies strictly inside this part
            if lo < excl < hi:
                # Split into two parts
                left_part = Interval(
                    left=part.left,
                    right=Bound(value=excl),
                    left_open=part.left_open,
                    right_open=True,
                )
                right_part = Interval(
                    left=Bound(value=excl),
                    right=part.right,
                    left_open=True,
                    right_open=part.right_open,
                )
                new_parts.append(left_part)
                new_parts.append(right_part)
            else:
                new_parts.append(part)
        result = new_parts

    return result


def choose_sample_point(interval: Interval) -> float | None:
    """Choose a sample point within an interval for sign evaluation.

    Rules:
    - Finite (a,b) → midpoint (a+b)/2
    - (-∞, b) → b - max(1, abs(b)*0.5 + 1)
    - (a, +∞) → a + max(1, abs(a)*0.5 + 1)
    """
    lo = _bound_value(interval.left)
    hi = _bound_value(interval.right)

    lo_inf = interval.left.is_infinite and not interval.left.is_positive_infinity
    hi_inf = interval.right.is_infinite and interval.right.is_positive_infinity

    if not lo_inf and not hi_inf:
        # Finite interval
        return (lo + hi) / 2.0

    if lo_inf and not hi_inf:
        # (-∞, b)
        offset = max(1.0, abs(hi) * 0.5 + 1.0)
        return hi - offset

    if not lo_inf and hi_inf:
        # (a, +∞)
        offset = max(1.0, abs(lo) * 0.5 + 1.0)
        return lo + offset

    # (-∞, +∞)
    return 0.0


def interval_contains(interval: Interval, point: float) -> bool:
    """Check if an interval contains a given point.

    Respects open/closed boundaries.
    """
    lo = _bound_value(interval.left)
    hi = _bound_value(interval.right)

    left_ok = False
    right_ok = False

    if interval.left.is_infinite and not interval.left.is_positive_infinity:
        left_ok = True
    else:
        if interval.left_open:
            left_ok = lo < point
        else:
            left_ok = lo <= point

    if interval.right.is_infinite and interval.right.is_positive_infinity:
        right_ok = True
    else:
        if interval.right_open:
            right_ok = point < hi
        else:
            right_ok = point <= hi

    return left_ok and right_ok


def domain_contains(domain_info: Any, point: float) -> bool:
    """Check if a point is inside the domain (not excluded)."""
    for excl in domain_info.excluded_points:
        try:
            if abs(float(excl) - point) < 1e-12:
                return False
        except (ValueError, TypeError):
            pass
    return True


def _bound_value(bound: Bound) -> Optional[float]:
    """Extract numeric value from a Bound, or None if infinite."""
    if bound.is_infinite:
        return None
    return bound.value
