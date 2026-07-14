"""Runtime-owned validation for authoritative Sage results."""

from __future__ import annotations

import copy
import json
import math
import os
import subprocess
from dataclasses import asdict
from functools import lru_cache
from typing import Any, Callable, Optional

from .models import RuntimeValidation, ValidationCheck


_VALID_SIGNS = {-1, 0, 1, "-", "0", "+", "negative", "zero", "positive"}
_CLASSIFICATION_BY_SIGNS = {
    ("+", "-"): "local_maximum",
    ("-", "+"): "local_minimum",
    ("+", "+"): "stationary_non_extremum",
    ("-", "-"): "stationary_non_extremum",
}


def _sign_name(value: Any) -> Optional[str]:
    if value in (1, "+", "positive"): return "+"
    if value in (-1, "-", "negative"): return "-"
    if value in (0, "0", "zero"): return "0"
    return None


def _number(value: Any) -> Optional[float]:
    if value is None: return None
    if isinstance(value, (int, float)) and not isinstance(value, bool): return float(value)
    text = str(value).strip().lower()
    if text in {"-inf", "-infinity", "-oo", "−∞"}: return -math.inf
    if text in {"inf", "+inf", "infinity", "+infinity", "oo", "+oo", "∞", "+∞"}: return math.inf
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _components(report: dict[str, Any]) -> list[dict[str, Any]]:
    domain = report.get("domain") if isinstance(report.get("domain"), dict) else {}
    value = domain.get("components", domain.get("connected_components", []))
    return value if isinstance(value, list) else []


def _excluded_points(report: dict[str, Any]) -> list[float]:
    domain = report.get("domain") if isinstance(report.get("domain"), dict) else {}
    raw = domain.get("excluded_points", domain.get("excluded", []))
    if not isinstance(raw, list): return []
    return [number for item in raw if (number := _number(item)) is not None]


def _point_in_domain(point: float, components: list[dict[str, Any]], exclusions: list[float]) -> bool:
    if any(math.isclose(point, excluded, rel_tol=0.0, abs_tol=1e-9) for excluded in exclusions):
        return False
    for component in components:
        left = _number(component.get("left"))
        right = _number(component.get("right"))
        if left is None or right is None: continue
        left_ok = point > left or (point == left and not component.get("left_open", True))
        right_ok = point < right or (point == right and not component.get("right_open", True))
        if left_ok and right_ok: return True
    return False


@lru_cache(maxsize=128)
def _sage_equivalent(expression: str, reported: str, variable: str, order: int) -> bool:
    script = "\n".join([
        "from sage.all import *",
        f"v = SR.var({json.dumps(variable)})",
        f"f = SR({json.dumps(expression)})",
        f"reported = SR({json.dumps(reported)})",
        f"print(bool((reported - diff(f, v, {order})).simplify_full() == 0))",
    ])
    env = dict(os.environ)
    env.setdefault("HOME", "/tmp/ds4-sage-validator-home")
    try:
        completed = subprocess.run(
            [env.get("DS4_SAGE_BINARY", "sage"), "-c", script],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
            env=env,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0 and completed.stdout.strip().splitlines()[-1:] == ["True"]


class SageRuntimeValidator:
    def __init__(
        self,
        equivalence_checker: Optional[Callable[[str, str, str, int], bool]] = None,
    ) -> None:
        self._equivalence_checker = equivalence_checker or _sage_equivalent

    def validate(
        self,
        *,
        task_type: str,
        execution: dict,
        candidate_report: dict | None,
        artifacts: list[dict],
    ) -> RuntimeValidation:
        checks: list[ValidationCheck] = []

        def check(code: str, passed: bool, message: str, **evidence: Any) -> None:
            checks.append(ValidationCheck(code, bool(passed), message, evidence))

        execution = execution if isinstance(execution, dict) else {}
        check("EXECUTION_OK", execution.get("ok") is True, "Sage execution completed.")
        check("EXECUTION_NOT_TIMED_OUT", execution.get("timedOut") is not True,
              "Sage execution did not time out.")
        check("EXECUTION_EXIT_CODE_ZERO", execution.get("exitCode") == 0,
              "Sage execution returned exit code zero.", exit_code=execution.get("exitCode"))
        report_ok = isinstance(candidate_report, dict)
        check("STRUCTURED_REPORT_PRESENT", report_ok, "A structured candidate report is present.")
        if not report_ok:
            return self._result(checks, None)

        try:
            json.dumps(candidate_report, allow_nan=False)
            serializable = True
        except (TypeError, ValueError):
            serializable = False
        check("NUMERIC_VALUES_SERIALIZABLE", serializable,
              "All report values are JSON serializable and finite.")

        normalized = copy.deepcopy(candidate_report) if serializable else None
        if task_type == "function_study":
            self._validate_function_study(candidate_report, artifacts, check)
        else:
            check("GENERIC_REPORT_KIND", candidate_report.get("kind") == "math_report",
                  "Generic Sage output uses the math_report schema.")

        return self._result(checks, normalized)

    def _result(
        self,
        checks: list[ValidationCheck],
        normalized: Optional[dict[str, Any]],
    ) -> RuntimeValidation:
        passed = bool(checks) and all(item.passed for item in checks)
        if passed and normalized is not None:
            normalized["authority"] = "runtime"
            normalized["validationPassed"] = True
        errors = [item.code for item in checks if not item.passed]
        return RuntimeValidation(
            authoritative=True,
            passed=passed,
            checks=checks,
            errors=errors,
            normalized_report=normalized if passed else None,
        )

    def _validate_function_study(
        self,
        report: dict[str, Any],
        artifacts: list[dict],
        check: Callable[..., None],
    ) -> None:
        domain = report.get("domain")
        components = _components(report)
        exclusions = _excluded_points(report)
        check("DOMAIN_PRESENT", isinstance(domain, dict) and bool(components),
              "The domain and its connected components are present.")

        ordered = True
        crosses_exclusion = False
        previous_right = -math.inf
        for component in components:
            left, right = _number(component.get("left")), _number(component.get("right"))
            if left is None or right is None or not left < right or left < previous_right:
                ordered = False
                continue
            previous_right = right
            if any(left < point < right for point in exclusions):
                crosses_exclusion = True
        check("DOMAIN_COMPONENTS_ORDERED", ordered and bool(components),
              "Domain components are ordered and non-overlapping.")
        check("NO_INTERVAL_CROSSES_EXCLUSION", not crosses_exclusion,
              "No domain component crosses an excluded point.")

        function_rows = report.get("function_sign_rows", report.get("signIntervals", []))
        function_rows = function_rows if isinstance(function_rows, list) else []
        check("FUNCTION_SIGN_CROSSCHECK", self._valid_sign_rows(function_rows, components, exclusions),
              "Function signs agree with runtime sample values.")

        expression = str(report.get("expression") or report.get("function", {}).get("plain") or "")
        variable = str(report.get("variable") or "x")
        first = report.get("first_derivative", report.get("firstDerivative", {}))
        second = report.get("second_derivative", report.get("secondDerivative", {}))
        first = first if isinstance(first, dict) else {}
        second = second if isinstance(second, dict) else {}
        first_reported = str(first.get("reported", first.get("latex", ""))).strip()
        second_reported = str(second.get("reported", second.get("latex", ""))).strip()
        check("FIRST_DERIVATIVE_PRESENT", bool(expression and first_reported),
              "The first derivative is present.")
        first_equivalent = bool(expression and first_reported) and self._equivalence_checker(
            expression, first_reported, variable, 1
        )
        check("FIRST_DERIVATIVE_EQUIVALENT", first_equivalent,
              "The reported first derivative is symbolically equivalent.")
        check("SECOND_DERIVATIVE_PRESENT", bool(expression and second_reported),
              "The second derivative is present.")
        second_equivalent = bool(expression and second_reported) and self._equivalence_checker(
            expression, second_reported, variable, 2
        )
        check("SECOND_DERIVATIVE_EQUIVALENT", second_equivalent,
              "The reported second derivative is symbolically equivalent.")

        first_rows = first.get("sign_rows", first.get("monotonicityIntervals", []))
        second_rows = second.get("sign_rows", second.get("concavityIntervals", []))
        first_rows = first_rows if isinstance(first_rows, list) else []
        second_rows = second_rows if isinstance(second_rows, list) else []
        check("FIRST_DERIVATIVE_SIGN_ROWS_COMPLETE", self._valid_sign_rows(first_rows, components, exclusions),
              "First-derivative sign rows have valid samples.")
        check("SECOND_DERIVATIVE_SIGN_ROWS_COMPLETE", self._valid_sign_rows(second_rows, components, exclusions),
              "Second-derivative sign rows have valid samples.")

        critical_points = report.get("critical_points", first.get("criticalPoints", []))
        critical_points = critical_points if isinstance(critical_points, list) else []
        critical_in_domain = all(
            _number(point.get("x")) is not None and
            _point_in_domain(float(_number(point.get("x"))), components, exclusions)
            for point in critical_points if isinstance(point, dict)
        )
        check("CRITICAL_POINTS_IN_DOMAIN", critical_in_domain,
              "All critical points belong to the original domain.")
        classifications_ok = True
        for point in critical_points:
            if not isinstance(point, dict): classifications_ok = False; continue
            expected = _CLASSIFICATION_BY_SIGNS.get((
                _sign_name(point.get("left_sign")), _sign_name(point.get("right_sign"))
            ))
            if expected is None or point.get("classification") != expected:
                classifications_ok = False
        check("EXTREMA_FROM_SIGN_CHANGES", classifications_ok,
              "Critical-point classifications follow derivative sign changes.")
        check("MONOTONICITY_FROM_SIGNS", all(_sign_name(row.get("sign")) in {"+", "-"}
              for row in first_rows if isinstance(row, dict)),
              "Monotonicity follows first-derivative signs.")

        component_ranges = report.get("component_ranges", [])
        declared_range = report.get("range", [])
        component_ranges = component_ranges if isinstance(component_ranges, list) else []
        declared_range = declared_range if isinstance(declared_range, list) else []
        check("COMPONENT_RANGES_VALID", bool(component_ranges) and all(
            isinstance(item, dict) and _number(item.get("left")) is not None and
            _number(item.get("right")) is not None and
            _number(item.get("left")) <= _number(item.get("right"))
            for item in component_ranges
        ), "Every domain component has a valid range interval.")
        check("FINAL_RANGE_IS_COMPONENT_UNION", self._canonical_intervals(component_ranges) ==
              self._canonical_intervals(declared_range),
              "The final range equals the union of component ranges.")

        absolute = report.get("absolute_extrema", {})
        absolute = absolute if isinstance(absolute, dict) else {}
        unbounded_below = any(_number(item.get("left")) == -math.inf for item in component_ranges
                              if isinstance(item, dict))
        unbounded_above = any(_number(item.get("right")) == math.inf for item in component_ranges
                              if isinstance(item, dict))
        absolute_ok = not (unbounded_below and absolute.get("minimum") is not None) and not (
            unbounded_above and absolute.get("maximum") is not None
        )
        check("ABSOLUTE_EXTREMA_MATCH_BOUNDEDNESS", absolute_ok,
              "Absolute extrema agree with range boundedness.")

        inflections = report.get("inflection_points", second.get("inflectionPoints", []))
        inflections = inflections if isinstance(inflections, list) else []
        inflections_in_domain = True
        inflections_change = True
        for point in inflections:
            if not isinstance(point, dict):
                inflections_in_domain = inflections_change = False
                continue
            numeric = _number(point.get("x"))
            if numeric is None or not _point_in_domain(numeric, components, exclusions):
                inflections_in_domain = False
            if (
                _sign_name(point.get("left_sign")) == _sign_name(point.get("right_sign"))
                or _sign_name(point.get("left_sign")) is None
                or _sign_name(point.get("right_sign")) is None
            ):
                inflections_change = False
        check("INFLECTION_POINTS_IN_DOMAIN", inflections_in_domain,
              "All inflection points belong to the original domain.")
        check("INFLECTION_POINTS_CHANGE_CONCAVITY", inflections_change,
              "Every inflection point changes concavity.")
        check("CONCAVITY_FROM_SIGNS", all(_sign_name(row.get("sign")) in {"+", "-", "0"}
              for row in second_rows if isinstance(row, dict)),
              "Concavity follows second-derivative signs.")

        artifact_kinds = {str(item.get("kind", "")) for item in artifacts if isinstance(item, dict)}
        required = {"function_plot", "first_derivative_plot", "second_derivative_plot"}
        check("PLOT_POINTS_MATCH_CLASSIFICATIONS", required.issubset(artifact_kinds),
              "The complete function-study plot package is present.",
              missing=sorted(required - artifact_kinds))

    @staticmethod
    def _valid_sign_rows(
        rows: list[dict[str, Any]],
        components: list[dict[str, Any]],
        exclusions: list[float],
    ) -> bool:
        if not rows: return False
        for row in rows:
            if not isinstance(row, dict) or row.get("sign") not in _VALID_SIGNS: return False
            sample = _number(row.get("sample_point"))
            if sample is None or not _point_in_domain(sample, components, exclusions): return False
            evaluated = _number(row.get("evaluated_value"))
            if evaluated is not None:
                actual = "+" if evaluated > 0 else "-" if evaluated < 0 else "0"
                if _sign_name(row.get("sign")) != actual: return False
        return True

    @staticmethod
    def _canonical_intervals(values: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
        canonical = []
        for item in values:
            if not isinstance(item, dict): continue
            canonical.append((
                _number(item.get("left")), _number(item.get("right")),
                bool(item.get("left_open", True)), bool(item.get("right_open", True)),
            ))
        return sorted(set(canonical))


def validate_payload(payload: dict[str, Any]) -> dict[str, Any]:
    validator = SageRuntimeValidator()
    result = validator.validate(
        task_type=str(payload.get("taskType", "auto")),
        execution=payload.get("execution", {}),
        candidate_report=payload.get("candidateReport"),
        artifacts=payload.get("artifacts", []),
    )
    return asdict(result)


def main() -> int:
    try:
        payload = json.load(os.sys.stdin)
        print(json.dumps(validate_payload(payload), allow_nan=False))
        return 0
    except Exception:
        print(json.dumps({
            "authoritative": False,
            "passed": False,
            "checks": [],
            "errors": ["SAGE_VALIDATOR_UNAVAILABLE"],
            "normalized_report": None,
        }))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
