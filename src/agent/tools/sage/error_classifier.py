"""Classify Sage execution errors into known categories for deterministic repair."""
from enum import Enum
from .models import SageExecutionResult


class SageErrorType(str, Enum):
    SYMBOLIC_QUO_REM = "symbolic_quo_rem"
    SOLVE_POLYNOMIAL_TYPE = "solve_polynomial_type"
    POSITIONAL_SUBSTITUTION = "positional_substitution"
    UNKNOWN_IDENTIFIER = "unknown_identifier"
    SYNTAX_ERROR = "syntax_error"
    TIMEOUT = "timeout"
    PLOT_FAILURE = "plot_failure"
    JSON_PARSE_FAILURE = "json_parse_failure"
    UNKNOWN = "unknown"


ERROR_PATTERNS: list[tuple[SageErrorType, str]] = [
    (SageErrorType.SYMBOLIC_QUO_REM, "object has no attribute 'quo_rem'"),
    (SageErrorType.SOLVE_POLYNOMIAL_TYPE, "must be a symbolic expression"),
    (SageErrorType.POSITIONAL_SUBSTITUTION,
     "Substitution using function-call syntax"),
    (SageErrorType.SYNTAX_ERROR, "SyntaxError"),
]


def classify_sage_error(execution: SageExecutionResult) -> SageErrorType:
    """Classify the error type from an execution result."""
    if execution.timed_out:
        return SageErrorType.TIMEOUT

    combined = execution.stdout + "\n" + execution.stderr

    for error_type, pattern in ERROR_PATTERNS:
        if pattern in combined:
            return error_type

    return SageErrorType.UNKNOWN
