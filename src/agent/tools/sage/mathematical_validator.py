"""Mathematical validator: checks domain, signs, monotonicity, concavity, inflection points."""
from typing import Any
from .models import (
    FunctionStudyResult,
    ValidationIssue,
    ValidationReport,
    SignValue,
)
from .interval_engine import interval_contains


def validate_function_study(result: FunctionStudyResult) -> ValidationReport:
    """Run all mathematical validation checks on a function study result.

    Returns a report with issues grouped by severity.
    """
    issues: list[ValidationIssue] = []

    # Domain checks
    if result.domain is not None:
        _validate_domain(result.domain, issues)

    # Sign checks
    _validate_sign_intervals(
        "function_signs", result.function_signs,
        result.domain.excluded_points if result.domain else [],
        issues,
    )

    # Monotonicity checks
    _validate_sign_intervals(
        "derivative_signs", result.derivative_signs,
        result.domain.excluded_points if result.domain else [],
        issues,
    )

    # Concavity checks
    _validate_sign_intervals(
        "concavity_signs",
        [cs for cs in (result.concavity_signs or [])],
        result.domain.excluded_points if result.domain else [],
        issues,
    )

    # Critical point classification
    for cp in (result.critical_points or []):
        if cp.classification == SignValue.UNKNOWN:
            issues.append(ValidationIssue(
                code="CRITICAL_POINT_UNKNOWN",
                severity="error",
                message=f"Critical point at x={cp.x_numeric} has unknown classification",
                field="critical_points",
            ))

    # Inflection points
    for ip in (result.inflection_points or []):
        x0 = ip.get("x_numeric")
        left_sign = ip.get("left_second_derivative_sign")
        right_sign = ip.get("right_second_derivative_sign")
        if left_sign is not None and right_sign is not None:
            if left_sign == right_sign:
                issues.append(ValidationIssue(
                    code="INFLECTION_WITHOUT_SIGN_CHANGE",
                    severity="warning",
                    message=f"No concavity change at inflection point x≈{x0}",
                    field="inflection_points",
                ))

    passed = all(
        iss.severity in ("info", "warning") for iss in issues
    )

    return ValidationReport(passed=passed, issues=issues)


def _validate_domain(domain: Any, issues: list[ValidationIssue]) -> None:
    """Check domain consistency."""
    # Check that excluded points are not inside connected components
    for comp in (domain.connected_components or []):
        for excl in (domain.excluded_points or []):
            try:
                pt = float(excl)
                if interval_contains(comp, pt):
                    issues.append(ValidationIssue(
                        code="DOMAIN_COMPONENT_CONTAINS_EXCLUDED_POINT",
                        severity="critical",
                        message=f"Component contains excluded point {excl}",
                        field="domain.connected_components",
                    ))
            except (ValueError, TypeError):
                pass


def _validate_sign_intervals(
    field_name: str,
    intervals: list[Any],
    exclusions: list[str],
    issues: list[ValidationIssue],
) -> None:
    """Check that sign intervals don't cross excluded points and have no UNKNOWN."""
    for si in intervals:
        iv = getattr(si, "interval", si.get("interval"))
        sign = getattr(si, "sign", si.get("sign"))

        # Check for UNKNOWN signs in critical sections
        if sign == SignValue.UNKNOWN:
            issues.append(ValidationIssue(
                code=f"{field_name}_UNKNOWN_SIGN",
                severity="error",
                message=f"Unknown sign in {field_name} interval",
                field=field_name,
            ))

        # Check that interval doesn't contain excluded points
        for excl_str in exclusions:
            try:
                pt = float(excl_str)
                if interval_contains(iv, pt):
                    issues.append(ValidationIssue(
                        code=f"{field_name}_INTERVAL_CROSSES_DOMAIN_GAP",
                        severity="critical",
                        message=f"Interval crosses excluded point {excl_str}",
                        field=field_name,
                    ))
            except (ValueError, TypeError):
                pass
