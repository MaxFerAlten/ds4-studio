"""Unit tests for Sage task classifier."""
import sys
from pathlib import Path

# Ensure src is on PYTHONPATH
src_path = Path(__file__).resolve().parents[4] / "src"
sys.path.insert(0, str(src_path))

from agent.tools.sage.classifier import classify_sage_task
from agent.tools.sage.models import SageTaskType


def test_function_study_direct():
    """'Fammi lo studio di funzione completo' → FUNCTION_STUDY"""
    result = classify_sage_task(
        "Fammi lo studio di funzione completo di f(x) = x^2 - 1"
    )
    assert result == SageTaskType.FUNCTION_STUDY, f"Expected FUNCTION_STUDY, got {result}"


def test_function_study_keyword_score():
    """Multiple keywords trigger FUNCTION_STUDY even without direct phrase."""
    result = classify_sage_task(
        "Calcola dominio, segno e asintoti della funzione"
    )
    assert result == SageTaskType.FUNCTION_STUDY, f"Expected FUNCTION_STUDY, got {result}"


def test_symbolic_generic_integral():
    """'Calcola l'integrale con Sage' → SYMBOLIC_GENERIC"""
    result = classify_sage_task("Calcola l'integrale con Sage")
    assert result == SageTaskType.SYMBOLIC_GENERIC, f"Expected SYMBOLIC_GENERIC, got {result}"


def test_plot_only():
    """'Disegna il grafico con Sage' → PLOT_ONLY"""
    result = classify_sage_task("Disegna il grafico con Sage")
    assert result == SageTaskType.PLOT_ONLY, f"Expected PLOT_ONLY, got {result}"


def test_equation_solve():
    """'Risolvi l'equazione con Sage' → EQUATION_SOLVE"""
    result = classify_sage_task("Risolvi l'equazione con Sage")
    assert result == SageTaskType.EQUATION_SOLVE, f"Expected EQUATION_SOLVE, got {result}"


def test_non_sage_request():
    """A generic request not related to Sage should return SYMBOLIC_GENERIC."""
    result = classify_sage_task("Cerca informazioni su Roma")
    assert result == SageTaskType.SYMBOLIC_GENERIC, f"Expected SYMBOLIC_GENERIC, got {result}"
