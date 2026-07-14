"""Controlled exceptions for SageMath orchestration V2."""


class SageOrchestrationError(Exception):
    """Base exception for all Sage orchestration errors."""
    pass


class UnsafeSageExpressionError(SageOrchestrationError):
    """Raised when the expression contains forbidden tokens or patterns."""
    pass


class SageExecutionFailedControlled(SageOrchestrationError):
    """Raised after max retries without successful execution."""
    pass


class SageResultParseError(SageOrchestrationError):
    """Raised when structured JSON result cannot be parsed from stdout."""
    pass


class SageValidationError(SageOrchestrationError):
    """Raised when mathematical validation fails critically."""
    pass


class SageQualityGateFailed(SageOrchestrationError):
    """Raised when the final quality gate rejects the output."""
    pass


class FinalCodeMutationError(SageOrchestrationError):
    """Raised when the final code hash differs from the executed code hash."""
    pass
