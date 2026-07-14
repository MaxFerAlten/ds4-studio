"""Parametric SageMath template for generating plots."""
import json

PLOT_TEMPLATE = r"""
import json

x = var({variable_literal})
f = {expression}

result = {{}}

# Generate plot
try:
    g = plot(f, (x, {x_min}, {x_max}), detect_poles=True)
    g.save("{output_path}")
    result["plot_saved"] = True
except Exception as e:
    result["error"] = str(e)
    result["plot_saved"] = False

print("__DS4_RESULT_BEGIN__")
print(json.dumps(result, ensure_ascii=False))
print("__DS4_RESULT_END__")
"""


def build_plot_code(
    expression: str,
    output_path: str = "plot.png",
    variable: str = "x",
    x_min: float = -10.0,
    x_max: float = 10.0,
) -> str:
    """Build a Sage script that generates and saves a plot."""
    return PLOT_TEMPLATE.format(
        variable_literal=f'"{variable}"',
        expression=expression,
        x_min=x_min,
        x_max=x_max,
        output_path=output_path,
    )
