"""Data models for SageMath orchestration V2."""
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class SageTaskType(str, Enum):
    FUNCTION_STUDY = "function_study"
    SYMBOLIC_GENERIC = "symbolic_generic"
    PLOT_ONLY = "plot_only"
    EQUATION_SOLVE = "equation_solve"
    UNKNOWN = "unknown"


class PointClassification(str, Enum):
    LOCAL_MAXIMUM = "local_maximum"
    LOCAL_MINIMUM = "local_minimum"
    STATIONARY_NON_EXTREMUM = "stationary_non_extremum"
    NON_DIFFERENTIABLE_EXTREMUM = "non_differentiable_extremum"
    UNKNOWN = "unknown"


class SignValue(int, Enum):
    NEGATIVE = -1
    ZERO = 0
    POSITIVE = 1
    UNDEFINED = 2
    UNKNOWN = 3


@dataclass
class SageRequest:
    request_id: str
    raw_user_text: str
    task_type: SageTaskType = SageTaskType.UNKNOWN
    expression: str = ""
    variable: str = "x"
    requested_sections: list[str] = field(default_factory=list)
    output_language: str = "it"
    katex_target: str = "obsidian"
    require_plot: bool = False
    require_final_code: bool = True


@dataclass(frozen=True)
class Bound:
    value: Optional[float] = None
    symbolic: Optional[str] = None
    is_infinite: bool = False
    is_positive_infinity: bool = False


@dataclass(frozen=True)
class Interval:
    left: Bound
    right: Bound
    left_open: bool = True
    right_open: bool = True


def interval_of(left_val: float, right_val: float) -> Interval:
    return Interval(
        left=Bound(value=left_val),
        right=Bound(value=right_val),
    )


def finite_bound(val: float) -> Bound:
    return Bound(value=val)


@dataclass
class DomainInfo:
    excluded_points: list[str] = field(default_factory=list)
    connected_components: list[Interval] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    source_expression: str = ""


@dataclass
class CriticalPoint:
    x_exact: Optional[str] = None
    x_numeric: float = 0.0
    y_exact: Optional[str] = None
    y_numeric: float = 0.0
    left_derivative_sign: SignValue = SignValue.UNKNOWN
    right_derivative_sign: SignValue = SignValue.UNKNOWN
    classification: PointClassification = PointClassification.UNKNOWN


@dataclass
class SignInterval:
    interval: Interval
    sample_point: float = 0.0
    sign: SignValue = SignValue.UNKNOWN
    evaluated_value: Optional[float] = None


@dataclass
class FunctionStudyResult:
    expression: str = ""
    variable: str = "x"
    domain: Optional[DomainInfo] = None
    symmetry: dict[str, Any] = field(default_factory=dict)
    x_intercepts: list[dict[str, Any]] = field(default_factory=list)
    y_intercept: Optional[dict[str, Any]] = None
    function_signs: list[SignInterval] = field(default_factory=list)
    limits: list[dict[str, Any]] = field(default_factory=list)
    asymptotes: list[dict[str, Any]] = field(default_factory=list)
    first_derivative: str = ""
    derivative_roots: list[str] = field(default_factory=list)
    derivative_signs: list[SignInterval] = field(default_factory=list)
    critical_points: list[CriticalPoint] = field(default_factory=list)
    second_derivative: str = ""
    second_derivative_roots: list[str] = field(default_factory=list)
    concavity_signs: list[SignInterval] = field(default_factory=list)
    inflection_points: list[dict[str, Any]] = field(default_factory=list)
    plot_path: Optional[str] = None
    final_sage_code: str = ""
    warnings: list[str] = field(default_factory=list)


@dataclass
class ValidationIssue:
    code: str = ""
    severity: str = "error"
    message: str = ""
    field: Optional[str] = None


@dataclass
class ValidationReport:
    passed: bool = False
    issues: list[ValidationIssue] = field(default_factory=list)


@dataclass
class SageExecutionResult:
    ok: bool = False
    exit_code: int = -1
    stdout: str = ""
    stderr: str = ""
    duration_ms: int = 0
    timed_out: bool = False
    code_path: str = ""
    attempt: int = 0


@dataclass
class PromptMetadata:
    name: str = ""
    version: str = ""
    sha256: str = ""


@dataclass
class NumericValue:
    exact: Optional[str] = None
    decimal: Optional[float] = None
    kind: str = "finite"


@dataclass
class ConcavityInterval:
    interval: Interval
    second_derivative_sign: SignValue = SignValue.UNKNOWN
    classification: str = "unknown"


@dataclass
class Asymptote:
    kind: str = ""
    equation: str = ""
    direction: Optional[str] = None
    verification_limits: list[dict] = field(default_factory=list)
    relative_position: list[SignInterval] = field(default_factory=list)


@dataclass
class PlotRequest:
    expression: str = ""
    variable: str = "x"
    domain_components: list[Interval] = field(default_factory=list)
    vertical_asymptotes: list[float] = field(default_factory=list)
    horizontal_asymptotes: list[str] = field(default_factory=list)
    oblique_asymptotes: list[str] = field(default_factory=list)
    notable_points: list[tuple] = field(default_factory=list)
    x_min: float = -10.0
    x_max: float = 10.0
    y_min: float = -15.0
    y_max: float = 15.0
    output_path: str = ""


@dataclass
class SageResponse:
    document: str = ""
    plot_path: Optional[str] = None
    code: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ValidationCheck:
    code: str
    passed: bool
    message: str
    evidence: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class RuntimeValidation:
    authoritative: bool
    passed: bool
    checks: list[ValidationCheck]
    errors: list[str]
    normalized_report: Optional[dict[str, Any]]
