"""Deterministic Sage execution plan builder.

Constructs a structured plan before any code is executed.
Each step can be marked as not_applicable rather than omitted.
"""
from typing import Any
from .models import SageRequest, SageTaskType

FUNCTION_STUDY_STEPS = [
    "normalize_expression",
    "compute_domain",
    "compute_symmetry",
    "compute_intercepts",
    "compute_function_sign",
    "compute_limits",
    "compute_asymptotes",
    "compute_first_derivative",
    "compute_derivative_roots",
    "compute_derivative_sign",
    "classify_critical_points",
    "compute_second_derivative",
    "compute_second_derivative_roots",
    "compute_concavity_sign",
    "classify_inflection_points",
    "compute_asymptote_relative_position",
    "generate_plot",
    "render_final_code",
    "validate_mathematics",
    "validate_katex",
    "final_quality_gate",
]

SYMBOLIC_GENERIC_STEPS = [
    "parse_expression",
    "evaluate_symbolic",
    "format_result",
    "validate_katex",
    "final_quality_gate",
]

PLOT_ONLY_STEPS = [
    "parse_expression",
    "determine_range",
    "generate_plot",
    "validate_katex",
    "final_quality_gate",
]

EQUATION_SOLVE_STEPS = [
    "parse_equation",
    "solve_symbolic",
    "verify_solutions",
    "format_result",
    "validate_katex",
    "final_quality_gate",
]


def build_plan(request: SageRequest) -> list[dict[str, Any]]:
    """Build a deterministic execution plan based on task type."""
    if request.task_type == SageTaskType.FUNCTION_STUDY:
        steps = FUNCTION_STUDY_STEPS
    elif request.task_type == SageTaskType.SYMBOLIC_GENERIC:
        steps = SYMBOLIC_GENERIC_STEPS
    elif request.task_type == SageTaskType.PLOT_ONLY:
        steps = PLOT_ONLY_STEPS
    elif request.task_type == SageTaskType.EQUATION_SOLVE:
        steps = EQUATION_SOLVE_STEPS
    else:
        steps = ["classify", "execute_generic", "format_result"]

    return [
        {"step": s, "status": "pending", "reason": None}
        for s in steps
    ]
