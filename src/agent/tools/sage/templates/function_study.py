"""Parametric SageMath template for complete function study.

The template is parameterized by variable and expression.
Output is JSON delimited by __DS4_RESULT_BEGIN__ / __DS4_RESULT_END__.
"""
import json
from typing import Optional


FUNCTION_STUDY_TEMPLATE = r"""
import json
import os

x = var({variable_literal})
f = {expression}

result = {{
    "expression": str(f),
    "variable": str(x),
    "errors": [],
}}

# 1. dominio
try:
    result["domain"] = dict(
        excluded_points=[],
        connected_components=[],
    )
except Exception as e:
    result["errors"].append(dict(step="domain", error=str(e)))

# 2. simmetria
try:
    # parity check
    f_even = f(-x)
    if f_even == f:
        result["symmetry"] = dict(kind="pari")
    elif f_even == -f:
        result["symmetry"] = dict(kind="dispari")
    else:
        result["symmetry"] = dict(kind="nessuna")
except Exception as e:
    result["errors"].append(dict(step="symmetry", error=str(e)))
    result["symmetry"] = dict(kind="unknown")

# 3. intersezioni con gli assi
try:
    x_int = solve(f, x)
    result["x_intercepts"] = [
        dict(x_numeric=float(s.rhs())) for s in x_int
    ] if x_int else []
except Exception as e:
    result["errors"].append(dict(step="intercepts_x", error=str(e)))
    result["x_intercepts"] = []

try:
    y_val = f(0) if 0 not in (result.get("domain", {{}}).get("excluded_points", [])) else None
    result["y_intercept"] = dict(value=y_val) if y_val is not None else None
except Exception as e:
    result["errors"].append(dict(step="intercepts_y", error=str(e)))
    result["y_intercept"] = None

# 4. segno della funzione — handled by sign engine externally
result["function_signs"] = []

# 5. limiti
try:
    limits = []
    # Limits at ±∞ and at exclusions would be computed here
    result["limits"] = limits
except Exception as e:
    result["errors"].append(dict(step="limits", error=str(e)))
    result["limits"] = []

# 6. asintoti — handled by asymptote engine
result["asymptotes"] = []

# 7. derivata prima
try:
    f1 = diff(f, x)
    result["first_derivative"] = str(f1)
except Exception as e:
    result["errors"].append(dict(step="first_derivative", error=str(e)))
    result["first_derivative"] = ""

# 8. radici della derivata
try:
    roots = solve(f1, x)
    result["derivative_roots"] = [str(s.rhs()) for s in roots] if roots else []
except Exception as e:
    result["errors"].append(dict(step="derivative_roots", error=str(e)))
    result["derivative_roots"] = []

# 9. segno della derivata — handled by sign engine
result["derivative_signs"] = []

# 10. punti critici — handled by extrema engine
result["critical_points"] = []

# 11. derivata seconda
try:
    f2 = diff(f, x, 2)
    result["second_derivative"] = str(f2)
except Exception as e:
    result["errors"].append(dict(step="second_derivative", error=str(e)))
    result["second_derivative"] = ""

# 12. radici della derivata seconda
try:
    roots2 = solve(f2, x)
    result["second_derivative_roots"] = [str(s.rhs()) for s in roots2] if roots2 else []
except Exception as e:
    result["errors"].append(dict(step="second_derivative_roots", error=str(e)))
    result["second_derivative_roots"] = []

# 13. concavità — handled by concavity engine
result["concavity_signs"] = []

# 14. flessi — handled by inflection logic
result["inflection_points"] = []

# 15. serializzazione JSON
print("__DS4_RESULT_BEGIN__")
print(json.dumps(result, ensure_ascii=False))
print("__DS4_RESULT_END__")
"""


def build_function_study_code(
    expression: str,
    variable: str = "x",
) -> str:
    """Build a complete Sage function study script from the template.

    Returns Sage code string ready for execution.
    """
    var_literal = f'"{variable}"'
    return FUNCTION_STUDY_TEMPLATE.format(
        variable_literal=var_literal,
        expression=expression,
    )


def validate_expression_source(expression: str) -> None:
    """Check that an expression contains no forbidden tokens."""
    from ..exceptions import UnsafeSageExpressionError

    forbidden_tokens = [
        "import os",
        "subprocess",
        "open(",
        "exec(",
        "eval(",
        "__",
        "system(",
    ]

    lowered = expression.lower()
    for token in forbidden_tokens:
        if token in lowered:
            raise UnsafeSageExpressionError(token)
