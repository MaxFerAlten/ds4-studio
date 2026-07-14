"""Plot builder: generates real SageMath PNG plots with separated branches."""
from pathlib import Path
from typing import Optional
from .models import PlotRequest, Interval


def build_plot_code(request: PlotRequest) -> str:
    """Generate Sage code for a multi-branch plot with asymptotes and points.

    Returns Sage code string that produces a PNG at request.output_path.
    """
    lines = [f"x = var('{request.variable}')"]
    lines.append(f"f = {request.expression}")
    lines.append("")
    lines.append("plots = []")
    eps = 0.02

    # Generate one plot per domain component visible in [x_min, x_max]
    for comp in request.domain_components:
        lo = _interval_left_value(comp)
        hi = _interval_right_value(comp)

        # Clamp to requested range
        lo = max(lo, request.x_min) if lo is not None else request.x_min
        hi = min(hi, request.x_max) if hi is not None else request.x_max

        # Apply epsilon offset near excluded boundaries
        lo += eps
        hi -= eps

        lines.append(f"""
plots.append(
    plot(
        f,
        (x, {lo}, {hi}),
        detect_poles=True,
        adaptive_recursion=8
    )
)""")

    # Sum all plots
    lines.append("")
    lines.append("graph = sum(plots)")

    # Add vertical asymptote lines
    for va in request.vertical_asymptotes:
        lines.append(
            f"graph += line([({va}, {request.y_min}), ({va}, {request.y_max})], "
            f"linestyle='--')"
        )

    # Add horizontal asymptote lines
    for ha_eq in request.horizontal_asymptotes:
        # Parse y = value
        try:
            y_val = float(ha_eq.split("=")[1].strip())
            lines.append(
                f"graph += plot({y_val}, (x, {request.x_min}, {request.x_max}), "
                f"linestyle='--')"
            )
        except (ValueError, IndexError):
            pass

    # Add oblique asymptote lines: y = m*x + q
    for oa_eq in request.oblique_asymptotes:
        # Placeholder — real parsing would extract slope and intercept
        lines.append(
            f"# Oblique asymptote: {oa_eq}"
        )

    # Add notable points
    for px, py, label in request.notable_points:
        lines.append(
            f"graph += point(({px}, {py}), size=30, color='red', "
            f"marker='o')"
        )

    # Save
    lines.append(f"""
graph.save(
    "{request.output_path}",
    xmin={request.x_min},
    xmax={request.x_max},
    ymin={request.y_min},
    ymax={request.y_max}
)""")

    return "\n".join(lines)


def validate_plot(output_path: str) -> bool:
    """Check that a plot file exists and has reasonable size."""
    p = Path(output_path)
    if not p.exists():
        return False
    size = p.stat().st_size
    return size > 1_000


def _interval_left_value(iv: Interval) -> float:
    b = iv.left
    if b.is_infinite:
        return -float("inf")
    return b.value or -10.0


def _interval_right_value(iv: Interval) -> float:
    b = iv.right
    if b.is_infinite:
        return float("inf")
    return b.value or 10.0
