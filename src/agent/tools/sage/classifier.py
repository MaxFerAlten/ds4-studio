"""Deterministic Sage task classifier.

Uses keyword-based rules before falling back to model classification.
"""
from .models import SageTaskType

FUNCTION_STUDY_KEYWORDS = [
    "studio di funzione",
    "dominio",
    "segno della funzione",
    "asintoti",
    "monotonia",
    "massimi e minimi",
    "derivata prima",
    "derivata seconda",
    "concavità",
    "flessi",
    "grafico completo",
]


def classify_sage_task(user_text: str) -> SageTaskType:
    """Classify a user request into a SageTaskType using deterministic rules."""
    normalized = user_text.lower()

    score = 0
    for keyword in FUNCTION_STUDY_KEYWORDS:
        if keyword in normalized:
            score += 1

    # Direct match takes priority
    if "studio di funzione" in normalized:
        return SageTaskType.FUNCTION_STUDY

    if score >= 3:
        return SageTaskType.FUNCTION_STUDY

    if "grafico" in normalized or "plot" in normalized:
        return SageTaskType.PLOT_ONLY

    if "risolvi" in normalized or "solve" in normalized:
        return SageTaskType.EQUATION_SOLVE

    return SageTaskType.SYMBOLIC_GENERIC
