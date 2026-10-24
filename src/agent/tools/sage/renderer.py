"""Structured document renderer for function study results.

Consumes only validated data. No mathematical reinterpretation.
"""
from typing import Any
from .models import (
    FunctionStudyResult,
    CriticalPoint,
    PointClassification,
    SignValue,
)
from .normalizer import format_it


def render_function_study(result: FunctionStudyResult) -> str:
    """Render a complete function study document from structured data.

    Returns Markdown with KaTeX math, ready for Obsidian.
    """
    sections = []

    # Title
    expr_latex = _expr_to_latex(result.expression)
    sections.append(f"# Studio di funzione\n\n")
    sections.append(f"$$f(x)={expr_latex}$$")
    sections.append("")

    # 1. Domain
    if result.domain is not None:
        sections.append(_render_domain(result.domain))

    # 2. Symmetry
    if result.symmetry:
        sections.append(_render_symmetry(result.symmetry))

    # 3. Intercepts
    sections.append(_render_intercepts(result.x_intercepts, result.y_intercept))

    # 4. Function sign
    if result.function_signs:
        sections.append(_render_sign_table(
            "Segno della funzione", result.function_signs
        ))

    # 5. Limits and continuity
    if result.limits:
        sections.append(_render_limits(result.limits))

    # 6. Asymptotes
    if result.asymptotes:
        sections.append(_render_asymptotes(result.asymptotes))

    # 7. First derivative
    sections.append(_render_first_derivative(result))

    # 8. Monotonicity
    if result.derivative_signs:
        sections.append(_render_monotonicity(result.derivative_signs))

    # 9. Critical points (maxima/minima)
    if result.critical_points:
        sections.append(_render_critical_points(result.critical_points))

    # 10. Second derivative
    sections.append(_render_second_derivative(result))

    # 11. Concavity
    if result.concavity_signs:
        sections.append(_render_concavity(result.concavity_signs))

    # 12. Inflection points
    if result.inflection_points:
        sections.append(_render_inflection_points(result.inflection_points))

    # 13. Relative position to asymptotes
    sections.append(_render_asymptote_position(result))

    # 14. Plot
    if result.plot_path:
        sections.append(_render_plot(result.plot_path))

    # 15. Qualitative summary
    sections.append(_render_summary(result))

    # 16. Final Sage code
    if result.final_sage_code:
        sections.append(_render_final_code(result.final_sage_code))

    return "\n\n".join(sections)


def _expr_to_latex(expr: str) -> str:
    """Convert a Sage expression string to LaTeX form."""
    result = expr.replace("**", "^")
    result = result.replace("*", " \\cdot ")
    return result


def _render_domain(domain: Any) -> str:
    lines = ["## Dominio"]
    excl = domain.excluded_points or []
    if excl:
        pts = ", ".join(str(e) for e in excl)
        lines.append(f"$$\\mathbb{{R}} \\setminus \\{{{pts}\\}}$$")
    else:
        lines.append("$$\\mathbb{R}$$")
    return "\n".join(lines)


def _render_symmetry(symmetry: dict) -> str:
    lines = ["## Simmetrie"]
    kind = symmetry.get("kind", "nessuna")
    lines.append(f"La funzione presenta simmetria **{kind}**.")
    return "\n".join(lines)


def _render_intercepts(x_int: list, y_int: dict | None) -> str:
    lines = ["## Intersezioni con gli assi"]

    if x_int:
        points = []
        for item in x_int:
            xn = item.get("x_numeric") or item.get("numeric")
            yn = item.get("y_numeric") or 0
            if xn is not None:
                points.append(f"$({format_it(xn)}, {format_it(yn)})$")
        if points:
            lines.append(f"- Asse $x$: {', '.join(points)}")

    if y_int is not None:
        val = y_int.get("value") or y_int.get("y_numeric")
        if val is not None:
            lines.append(f"- Asse $y$: $({format_it(0)}, {format_it(val)})$")
        else:
            lines.append("- Asse $y$: non applicabile (punto escluso dal dominio)")

    return "\n".join(lines)


def _render_sign_table(title: str, signs: list) -> str:
    lines = [f"## {title}", ""]
    lines.append("| Intervallo | Segno |")
    lines.append("|---|---|")

    for si in signs:
        iv = si.interval
        lo_str = _interval_label(iv.left)
        hi_str = _interval_label(iv.right)

        sign_label = {
            SignValue.POSITIVE: "$+$",
            SignValue.NEGATIVE: "$-$",
            SignValue.ZERO: "$0$",
            SignValue.UNDEFINED: "non definito",
            SignValue.UNKNOWN: "?",
        }.get(si.sign, "?")

        interval_str = f"$({lo_str}, {hi_str})$"
        lines.append(f"| {interval_str} | {sign_label} |")

    return "\n".join(lines)


def _render_limits(limits: list[dict]) -> str:
    lines = ["## Limiti e continuità"]
    for lim in limits:
        desc = lim.get("description", "")
        val = lim.get("value", "")
        if isinstance(val, (int, float)):
            val_str = format_it(float(val))
        else:
            val_str = str(val)
        lines.append(f"- $\\displaystyle \\lim_{{{desc}}} = {val_str}$")
    return "\n".join(lines)


def _render_asymptotes(asymptotes: list) -> str:
    lines = ["## Asintoti"]
    for a in asymptotes:
        kind_label = {
            "vertical": "verticale",
            "horizontal": "orizzontale",
            "oblique": "obliquo",
        }.get(a.kind, a.kind)
        eq_latex = a.equation.replace("x = ", "$x=").replace("y = ", "$y=")
        lines.append(f"- Asintoto **{kind_label}**: {eq_latex}$")
    return "\n".join(lines)


def _render_first_derivative(result: FunctionStudyResult) -> str:
    lines = ["## Derivata prima"]
    if result.first_derivative:
        deriv = result.first_derivative.replace("**", "^").replace("*", " ")
        lines.append(f"$$f'(x)={deriv}$$")

    if result.derivative_roots:
        roots = ", ".join(
            f"$x\\approx{format_it(float(r))}$" if r else r
            for r in result.derivative_roots
        )
        lines.append(f"\nZeri della derivata: {roots}")

    return "\n".join(lines)


def _render_monotonicity(derivative_signs: list) -> str:
    increasing: list[str] = []
    decreasing: list[str] = []

    for si in derivative_signs:
        iv = si.interval
        lo_str = _interval_label(iv.left, short=True)
        hi_str = _interval_label(iv.right, short=True)

        if si.sign == SignValue.POSITIVE:
            increasing.append(f"$({lo_str}, {hi_str})$")
        elif si.sign == SignValue.NEGATIVE:
            decreasing.append(f"$({lo_str}, {hi_str})$")

    lines = ["## Monotonia"]
    if increasing:
        lines.append(f"- **Crescente**: {', '.join(increasing)}")
    if decreasing:
        lines.append(f"- **Decrescente**: {', '.join(decreasing)}")
    return "\n".join(lines)


def _render_critical_points(points: list[CriticalPoint]) -> str:
    lines = ["## Massimi e minimi"]

    labels = {
        PointClassification.LOCAL_MAXIMUM: "massimo locale",
        PointClassification.LOCAL_MINIMUM: "minimo locale",
        PointClassification.STATIONARY_NON_EXTREMUM: "punto stazionario non estremo",
    }

    for cp in points:
        label = labels.get(cp.classification, cp.classification.value)
        x_str = format_it(cp.x_numeric)
        y_str = format_it(cp.y_numeric) if cp.y_exact is None else (
            f"${cp.y_exact}$"
        )
        lines.append(
            f"- **{label}** per $x\\approx{x_str}$, "
            f"con $f(x)\\approx{y_str}$."
        )

    return "\n".join(lines)


def _render_second_derivative(result: FunctionStudyResult) -> str:
    lines = ["## Derivata seconda"]
    if result.second_derivative:
        deriv2 = result.second_derivative.replace("**", "^").replace("*", " ")
        lines.append(f"$$f''(x)={deriv2}$$")

    if result.second_derivative_roots:
        roots = ", ".join(
            f"$x\\approx{format_it(float(r))}$" if r else r
            for r in result.second_derivative_roots
        )
        lines.append(f"\nZeri della derivata seconda: {roots}")

    return "\n".join(lines)


def _render_concavity(concavity_signs: list) -> str:
    convex: list[str] = []
    concave: list[str] = []

    for ci in concavity_signs:
        iv = ci.interval
        lo_str = _interval_label(iv.left, short=True)
        hi_str = _interval_label(iv.right, short=True)

        if ci.classification == "convex":
            convex.append(f"$({lo_str}, {hi_str})$")
        elif ci.classification == "concave":
            concave.append(f"$({lo_str}, {hi_str})$")

    lines = ["## Concavità e convessità"]
    if convex:
        lines.append(f"- **Convessa** (verso l'alto): {', '.join(convex)}")
    if concave:
        lines.append(f"- **Concava** (verso il basso): {', '.join(concave)}")
    return "\n".join(lines)


def _render_inflection_points(points: list[dict]) -> str:
    lines = ["## Flessi"]
    for ip in points:
        xn = ip.get("x_numeric")
        yn = ip.get("y_numeric")
        if xn is not None and yn is not None:
            lines.append(
                f"- Flesso per $x\\approx{format_it(xn)}$, "
                f"con $f(x)\\approx{format_it(yn)}$."
            )
    return "\n".join(lines)


def _render_asymptote_position(result: FunctionStudyResult) -> str:
    # Placeholder — real implementation would use relative position data
    return ""


def _render_plot(plot_path: str) -> str:
    lines = ["## Grafico", ""]
    lines.append(f"![]({plot_path})")
    return "\n".join(lines)


def _render_summary(result: FunctionStudyResult) -> str:
    lines = ["## Riepilogo qualitativo"]

    domain_str = ""
    if result.domain:
        excl = result.domain.excluded_points or []
        if excl:
            pts = ", ".join(str(e) for e in excl)
            domain_str = f"dominio $\\mathbb{{R}}\\setminus\\{{{pts}\\}}$"
        else:
            domain_str = "dominio $\\mathbb{R}$"

    monotony = ""
    incr_count = sum(
        1 for si in (result.derivative_signs or [])
        if si.sign == SignValue.POSITIVE
    )
    decr_count = sum(
        1 for si in (result.derivative_signs or [])
        if si.sign == SignValue.NEGATIVE
    )
    if incr_count and decr_count:
        monotony = (
            f"{incr_count} intervalli crescenti, "
            f"{decr_count} intervalli decrescenti"
        )

    extremum_count = len(result.critical_points or [])
    inflection_count = len(result.inflection_points or [])

    parts = []
    if domain_str:
        parts.append(domain_str)
    if monotony:
        parts.append(monotony)
    if extremum_count:
        parts.append(f"{extremum_count} punti critici")
    if inflection_count:
        parts.append(f"{inflection_count} flessi")

    lines.append(", ".join(parts) + ".")
    return "\n".join(lines)


def _render_final_code(code: str) -> str:
    lines = ["## Codice Sage completo", ""]
    lines.append("```sage")
    lines.append(code)
    lines.append("```")
    return "\n".join(lines)


def _interval_label(bound: Any, short: bool = False) -> str:
    """Generate a label string for an interval bound."""
    if bound.is_infinite and not bound.is_positive_infinity:
        return "-\\infty" if short else "-∞"
    if bound.is_infinite and bound.is_positive_infinity:
        return "+\\infty" if short else "+∞"

    val = bound.value
    if val is None:
        return "?"

    if abs(val - int(val)) < 1e-6:
        return str(int(val))
    return format_it(float(val))
