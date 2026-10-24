"""Final quality gate: blocks delivery if critical errors remain."""
from typing import Optional
from .models import ValidationReport, SageExecutionResult

#: Task types that cannot be published without their plot package. Mirrors
#: SAGE_PLOT_REQUIRED_TASK_TYPES in frontend/server/sageOrchestrationConfig.mjs;
#: both spellings are accepted because the JS catalogue and the Python enum use
#: different names for the same two tasks.
PLOT_REQUIRED_TASKS = frozenset({"function_study", "plot_only", "plot"})


def requires_plots(task_type: Optional[str]) -> bool:
    """True when this task type must deliver plots to be publishable."""
    return str(task_type or "").strip().lower() in PLOT_REQUIRED_TASKS


def can_publish(
    math_report: ValidationReport,
    katex_report: ValidationReport,
    final_execution: Optional[SageExecutionResult] = None,
    plot_ok: bool = False,
    task_type: Optional[str] = "function_study",
) -> bool:
    """Check all quality gates before publishing a response.

    Returns True only if ALL checks pass.

    ``plot_ok`` is only a gate for graphical tasks: requiring a plot from an
    ``evaluate`` request penalised it for something it was never asked to
    produce. The default keeps the historical behaviour for callers that do not
    pass a task type.
    """
    # Final code must have been executed successfully
    if final_execution is not None and not final_execution.ok:
        return False

    # Mathematical validation must pass
    if not math_report.passed:
        return False

    # KaTeX validation must pass
    if not katex_report.passed:
        return False

    # Plots are required only where they are part of the deliverable
    if requires_plots(task_type) and not plot_ok:
        return False

    return True


def blocking_issues() -> list[str]:
    """Return the list of conditions that block publication."""
    return [
        "interval crosses excluded point",
        "critical point classification UNKNOWN",
        "critical sign UNKNOWN",
        "final code not executed",
        "malformed KaTeX table",
        "missing plot in complete study",
        "incomplete structured output",
        "traceback visible in document",
        "corrupted characters in document",
        "hash mismatch between executed code and displayed code",
    ]
