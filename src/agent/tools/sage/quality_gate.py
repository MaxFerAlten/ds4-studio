"""Final quality gate: blocks delivery if critical errors remain."""
from typing import Optional
from .models import ValidationReport, SageExecutionResult


def can_publish(
    math_report: ValidationReport,
    katex_report: ValidationReport,
    final_execution: Optional[SageExecutionResult] = None,
    plot_ok: bool = False,
) -> bool:
    """Check all quality gates before publishing a response.

    Returns True only if ALL checks pass.
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

    # Plot must exist for function study
    if not plot_ok:
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
