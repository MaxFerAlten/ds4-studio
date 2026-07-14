"""Parametric SageMath template for generic symbolic computation."""
import json

SYMBOLIC_GENERIC_TEMPLATE = r"""
import json

x = var({variable_literal})
expr = {expression}

result = {{}}

# Evaluate
try:
    evaluated = expr
    result["evaluated"] = str(evaluated)
except Exception as e:
    result["error"] = str(e)

# LaTeX representation
try:
    from sage.all import latex
    result["latex"] = str(latex(expr))
except Exception:
    result["latex"] = None

print("__DS4_RESULT_BEGIN__")
print(json.dumps(result, ensure_ascii=False))
print("__DS4_RESULT_END__")
"""


def build_symbolic_code(
    expression: str,
    variable: str = "x",
) -> str:
    """Build a Sage script for generic symbolic evaluation."""
    var_literal = f'"{variable}"'
    return SYMBOLIC_GENERIC_TEMPLATE.format(
        variable_literal=var_literal,
        expression=expression,
    )
