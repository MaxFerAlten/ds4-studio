from __future__ import annotations

import copy

from src.agent.tools.sage.runtime_validator import SageRuntimeValidator


ARTIFACTS = [
    {"kind": "function_plot", "name": "function.png"},
    {"kind": "first_derivative_plot", "name": "first.png"},
    {"kind": "second_derivative_plot", "name": "second.png"},
]


def report_fixture() -> dict:
    return {
        "kind": "function_study_v1",
        "expression": "1/x^2",
        "variable": "x",
        "domain": {
            "excluded_points": [0],
            "components": [
                {"left": "-inf", "right": 0, "left_open": True, "right_open": True},
                {"left": 0, "right": "inf", "left_open": True, "right_open": True},
            ],
        },
        "function_sign_rows": [
            {"sample_point": -1, "sign": "+", "evaluated_value": 1},
            {"sample_point": 1, "sign": "+", "evaluated_value": 1},
        ],
        "first_derivative": {
            "reported": "-2/x^3",
            "sign_rows": [
                {"sample_point": -1, "sign": "+", "evaluated_value": 2},
                {"sample_point": 1, "sign": "-", "evaluated_value": -2},
            ],
        },
        "critical_points": [],
        "absolute_extrema": {"minimum": None, "maximum": None},
        "component_ranges": [
            {"left": 0, "right": "inf", "left_open": True, "right_open": True},
            {"left": 0, "right": "inf", "left_open": True, "right_open": True},
        ],
        "range": [
            {"left": 0, "right": "inf", "left_open": True, "right_open": True},
        ],
        "second_derivative": {
            "reported": "6/x^4",
            "sign_rows": [
                {"sample_point": -1, "sign": "+", "evaluated_value": 6},
                {"sample_point": 1, "sign": "+", "evaluated_value": 6},
            ],
        },
        "inflection_points": [],
        "passed": True,
    }


def checker(expression: str, reported: str, variable: str, order: int) -> bool:
    expected = {1: "-2/x^3", 2: "6/x^4"}
    return expression == "1/x^2" and variable == "x" and reported == expected[order]


def validate(report: dict, artifacts=None):
    return SageRuntimeValidator(equivalence_checker=checker).validate(
        task_type="function_study",
        execution={"ok": True, "exitCode": 0, "timedOut": False},
        candidate_report=report,
        artifacts=ARTIFACTS if artifacts is None else artifacts,
    )


def failed(result, code: str) -> bool:
    return any(check.code == code and not check.passed for check in result.checks)


def test_rational_function_with_disconnected_domain_passes():
    assert validate(report_fixture()).passed is True


def test_interval_crossing_a_pole_fails():
    report = report_fixture()
    report["domain"]["components"] = [{"left": "-inf", "right": "inf"}]
    result = validate(report)
    assert failed(result, "NO_INTERVAL_CROSSES_EXCLUSION")


def test_inverted_maximum_minimum_fails():
    report = report_fixture()
    report["critical_points"] = [{
        "x": -1, "left_sign": "+", "right_sign": "-", "classification": "local_minimum"
    }]
    result = validate(report)
    assert failed(result, "EXTREMA_FROM_SIGN_CHANGES")


def test_absolute_minimum_on_unbounded_below_range_fails():
    report = report_fixture()
    report["component_ranges"] = [{"left": "-inf", "right": "inf"}]
    report["range"] = [{"left": "-inf", "right": "inf"}]
    report["absolute_extrema"]["minimum"] = {"x": 0, "value": 0}
    result = validate(report)
    assert failed(result, "ABSOLUTE_EXTREMA_MATCH_BOUNDEDNESS")


def test_wrong_first_derivative_fails():
    report = report_fixture()
    report["first_derivative"]["reported"] = "2/x^3"
    assert failed(validate(report), "FIRST_DERIVATIVE_EQUIVALENT")


def test_wrong_second_derivative_fails():
    report = report_fixture()
    report["second_derivative"]["reported"] = "-6/x^4"
    assert failed(validate(report), "SECOND_DERIVATIVE_EQUIVALENT")


def test_false_zero_of_second_derivative_fails_equivalence():
    report = report_fixture()
    report["second_derivative"]["reported"] = "0"
    assert failed(validate(report), "SECOND_DERIVATIVE_EQUIVALENT")


def test_false_inflection_without_sign_change_fails():
    report = report_fixture()
    report["inflection_points"] = [{"x": 1, "left_sign": "+", "right_sign": "+"}]
    assert failed(validate(report), "INFLECTION_POINTS_CHANGE_CONCAVITY")


def test_concavity_change_at_excluded_point_is_not_an_inflection():
    report = report_fixture()
    report["inflection_points"] = [{"x": 0, "left_sign": "+", "right_sign": "-"}]
    assert failed(validate(report), "INFLECTION_POINTS_IN_DOMAIN")


def test_redundant_but_equivalent_range_is_normalized():
    report = report_fixture()
    result = validate(report)
    assert result.passed is True
    assert result.normalized_report["authority"] == "runtime"


def test_mathematically_false_range_fails():
    report = report_fixture()
    report["range"] = [{"left": "-inf", "right": "inf"}]
    assert failed(validate(report), "FINAL_RANGE_IS_COMPONENT_UNION")


def test_even_power_marked_negative_fails_sign_crosscheck():
    report = report_fixture()
    report["function_sign_rows"][0]["sign"] = "-"
    assert failed(validate(report), "FUNCTION_SIGN_CROSSCHECK")


def test_odd_negative_value_marked_positive_fails_sign_crosscheck():
    report = report_fixture()
    report["function_sign_rows"][0] = {
        "sample_point": -1, "sign": "+", "evaluated_value": -1
    }
    assert failed(validate(report), "FUNCTION_SIGN_CROSSCHECK")


def test_stationary_non_extremum_is_accepted():
    report = report_fixture()
    report["critical_points"] = [{
        "x": -1, "left_sign": "+", "right_sign": "+",
        "classification": "stationary_non_extremum"
    }]
    assert validate(report).passed is True


def test_logarithmic_domain_fixture_is_structurally_valid():
    report = report_fixture()
    report["domain"]["components"] = [{"left": 0, "right": "inf"}]
    report["domain"]["excluded_points"] = [0]
    report["function_sign_rows"] = [{"sample_point": 1, "sign": "0", "evaluated_value": 0}]
    report["first_derivative"]["sign_rows"] = [{"sample_point": 1, "sign": "+", "evaluated_value": 1}]
    report["second_derivative"]["sign_rows"] = [{"sample_point": 1, "sign": "-", "evaluated_value": -1}]
    assert not failed(validate(report), "DOMAIN_PRESENT")


def test_even_root_endpoint_can_be_closed():
    report = report_fixture()
    report["domain"] = {
        "excluded_points": [],
        "components": [{"left": 0, "right": "inf", "left_open": False, "right_open": True}],
    }
    report["function_sign_rows"] = [{"sample_point": 1, "sign": "+", "evaluated_value": 1}]
    report["first_derivative"]["sign_rows"] = [{"sample_point": 1, "sign": "+", "evaluated_value": 1}]
    report["second_derivative"]["sign_rows"] = [{"sample_point": 1, "sign": "-", "evaluated_value": -1}]
    assert not failed(validate(report), "DOMAIN_COMPONENTS_ORDERED")


def test_transcendental_numeric_sample_points_are_certified_by_rows():
    report = report_fixture()
    report["first_derivative"]["sign_rows"][0]["sample_point"] = -0.75
    assert not failed(validate(report), "FIRST_DERIVATIVE_SIGN_ROWS_COMPLETE")


def test_removable_discontinuity_preserves_hole_and_disconnected_image():
    report = {
        "kind": "function_study_v1",
        "expression": "(x^2-1)/(x-1)",
        "variable": "x",
        "domain": {
            "excluded_points": [1],
            "components": [
                {"left": "-inf", "right": 1, "left_open": True, "right_open": True},
                {"left": 1, "right": "inf", "left_open": True, "right_open": True},
            ],
        },
        "holes": [{"x": 1, "y": 2, "limit_exists": True}],
        "function_sign_rows": [
            {"sample_point": -2, "sign": "-", "evaluated_value": -1},
            {"sample_point": 2, "sign": "+", "evaluated_value": 3},
        ],
        "first_derivative": {
            "reported": "1",
            "sign_rows": [
                {"sample_point": 0, "sign": "+", "evaluated_value": 1},
                {"sample_point": 2, "sign": "+", "evaluated_value": 1},
            ],
        },
        "critical_points": [],
        "absolute_extrema": {"minimum": None, "maximum": None},
        "component_ranges": [
            {"left": "-inf", "right": 2, "left_open": True, "right_open": True},
            {"left": 2, "right": "inf", "left_open": True, "right_open": True},
        ],
        "range": [
            {"left": "-inf", "right": 2, "left_open": True, "right_open": True},
            {"left": 2, "right": "inf", "left_open": True, "right_open": True},
        ],
        "second_derivative": {
            "reported": "0",
            "sign_rows": [
                {"sample_point": 0, "sign": "0", "evaluated_value": 0},
                {"sample_point": 2, "sign": "0", "evaluated_value": 0},
            ],
        },
        "inflection_points": [],
    }
    equivalence = lambda expression, reported, variable, order: (
        expression == "(x^2-1)/(x-1)" and variable == "x" and
        reported == ({1: "1", 2: "0"}[order])
    )
    result = SageRuntimeValidator(equivalence_checker=equivalence).validate(
        task_type="function_study",
        execution={"ok": True, "exitCode": 0, "timedOut": False},
        candidate_report=report,
        artifacts=ARTIFACTS,
    )
    assert result.passed is True
    assert result.normalized_report["domain"]["excluded_points"] == [1]
    assert result.normalized_report["holes"] == [
        {"x": 1, "y": 2, "limit_exists": True}
    ]
    assert len(result.normalized_report["range"]) == 2


def test_real_inflection_and_stationary_non_extremum_are_kept_distinct():
    report = {
        "kind": "function_study_v1",
        "expression": "x^3",
        "variable": "x",
        "domain": {
            "excluded_points": [],
            "components": [{"left": "-inf", "right": "inf"}],
        },
        "function_sign_rows": [
            {"sample_point": -1, "sign": "-", "evaluated_value": -1},
            {"sample_point": 1, "sign": "+", "evaluated_value": 1},
        ],
        "first_derivative": {
            "reported": "3*x^2",
            "sign_rows": [
                {"sample_point": -1, "sign": "+", "evaluated_value": 3},
                {"sample_point": 1, "sign": "+", "evaluated_value": 3},
            ],
        },
        "critical_points": [{
            "x": 0, "left_sign": "+", "right_sign": "+",
            "classification": "stationary_non_extremum",
        }],
        "absolute_extrema": {"minimum": None, "maximum": None},
        "component_ranges": [{"left": "-inf", "right": "inf"}],
        "range": [{"left": "-inf", "right": "inf"}],
        "second_derivative": {
            "reported": "6*x",
            "sign_rows": [
                {"sample_point": -1, "sign": "-", "evaluated_value": -6},
                {"sample_point": 1, "sign": "+", "evaluated_value": 6},
            ],
        },
        "inflection_points": [{
            "x": 0, "y": 0, "left_sign": "-", "right_sign": "+",
        }],
    }
    equivalence = lambda expression, reported, variable, order: (
        expression == "x^3" and variable == "x" and
        reported == ({1: "3*x^2", 2: "6*x"}[order])
    )
    result = SageRuntimeValidator(equivalence_checker=equivalence).validate(
        task_type="function_study",
        execution={"ok": True, "exitCode": 0, "timedOut": False},
        candidate_report=report,
        artifacts=ARTIFACTS,
    )
    assert result.passed is True
    assert result.normalized_report["critical_points"][0]["classification"] == \
        "stationary_non_extremum"
    assert result.normalized_report["inflection_points"] == [
        {"x": 0, "y": 0, "left_sign": "-", "right_sign": "+"}
    ]


def test_asymptotic_branches_require_the_complete_plot_package():
    report = report_fixture()
    result = validate(report, artifacts=ARTIFACTS[:2])
    assert failed(result, "PLOT_POINTS_MATCH_CLASSIFICATIONS")
    assert validate(report, artifacts=ARTIFACTS).passed is True


def test_complete_report_passes_and_ignores_model_pass_claim():
    report = report_fixture()
    report["passed"] = False
    result = validate(report)
    assert result.passed is True
    assert result.authoritative is True


def test_checks_are_never_empty():
    result = validate(report_fixture())
    assert result.checks


def test_passed_equals_all_runtime_checks():
    good = validate(report_fixture())
    bad_report = copy.deepcopy(report_fixture())
    bad_report["domain"]["components"] = []
    bad = validate(bad_report)
    assert good.passed == all(check.passed for check in good.checks)
    assert bad.passed == all(check.passed for check in bad.checks)
