"""Deterministic classification of stationary points from derivative sign changes."""
from .models import SignValue, PointClassification


def classify_stationary_point(
    left_sign: SignValue,
    right_sign: SignValue,
) -> PointClassification:
    """Classify a critical point based on the sign change of f' around it.

    Rules:
    - POSITIVE → NEGATIVE : local maximum
    - NEGATIVE → POSITIVE : local minimum
    - same sign           : stationary non-extremum (saddle)
    - otherwise           : unknown
    """
    if (
        left_sign == SignValue.POSITIVE
        and right_sign == SignValue.NEGATIVE
    ):
        return PointClassification.LOCAL_MAXIMUM

    if (
        left_sign == SignValue.NEGATIVE
        and right_sign == SignValue.POSITIVE
    ):
        return PointClassification.LOCAL_MINIMUM

    if left_sign == right_sign:
        return PointClassification.STATIONARY_NON_EXTREMUM

    return PointClassification.UNKNOWN
