"""Fase S0 del piano di orchestrazione autonoma Sage — difetto S0-07.

Il quality gate blocca la pubblicazione quando ``plot_ok`` è falso, per
qualunque task type. Un task ``evaluate`` (nessun grafico richiesto) viene
quindi penalizzato da un requisito che non lo riguarda.

Prima della patch questo modulo fallisce; dopo la fase S5 deve passare.
"""
import pytest

from src.agent.tools.sage.models import ValidationReport
from src.agent.tools.sage.quality_gate import can_publish, requires_plots


def _passing_report() -> ValidationReport:
    return ValidationReport(passed=True, issues=[])


def test_evaluate_task_does_not_require_plots():
    """S0-07: un task senza grafici non deve essere penalizzato da plot_ok."""
    assert requires_plots("evaluate") is False
    assert can_publish(
        math_report=_passing_report(),
        katex_report=_passing_report(),
        final_execution=None,
        plot_ok=False,
        task_type="evaluate",
    ) is True


def test_function_study_still_requires_plots():
    """Il rilassamento non deve toccare lo studio di funzione."""
    assert requires_plots("function_study") is True
    assert can_publish(
        math_report=_passing_report(),
        katex_report=_passing_report(),
        final_execution=None,
        plot_ok=False,
        task_type="function_study",
    ) is False


@pytest.mark.parametrize("task_type", ["function_study", "evaluate", "auto"])
def test_math_failure_always_blocks(task_type):
    assert can_publish(
        math_report=ValidationReport(passed=False, issues=[]),
        katex_report=_passing_report(),
        final_execution=None,
        plot_ok=True,
        task_type=task_type,
    ) is False
