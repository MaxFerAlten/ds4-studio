"""Normalize SageMath string outputs into structured numeric values."""
from typing import Optional
from .models import NumericValue


def normalize_numeric_value(
    raw: str | float | int | None,
) -> NumericValue:
    """Convert a Sage string or number into a structured NumericValue.

    Handles -Infinity, +Infinity, fractions, sqrt expressions.
    """
    if raw is None:
        return NumericValue(exact=None, decimal=None, kind="unknown")

    if isinstance(raw, (float, int)):
        return NumericValue(exact=str(raw), decimal=float(raw), kind="finite")

    text = str(raw).strip()

    # Infinity cases
    if text in ("-Infinity", "-infinity", "−∞"):
        return NumericValue(exact="-Infinity", decimal=None, kind="negative_infinity")
    if text in ("+Infinity", "+infinity", "Infinity", "∞"):
        return NumericValue(exact="+Infinity", decimal=None, kind="positive_infinity")

    # Try float parse
    try:
        val = float(text)
        return NumericValue(exact=text, decimal=val, kind="finite")
    except ValueError:
        pass

    # Fraction-like: "1/4"
    if "/" in text:
        from fractions import Fraction
        try:
            frac = Fraction(text)
            return NumericValue(
                exact=text,
                decimal=float(frac.numerator) / float(frac.denominator),
                kind="finite",
            )
        except ZeroDivisionError:
            return NumericValue(exact=text, decimal=None, kind="undefined")

    # sqrt or symbolic expression — keep exact form only
    return NumericValue(exact=text, decimal=None, kind="symbolic")


def normalize_domain_exclusions(raw_list: list | None) -> list[str]:
    """Normalize domain exclusion points to strings."""
    if not raw_list:
        return []
    result: list[str] = []
    for item in raw_list:
        if isinstance(item, (int, float)):
            result.append(str(item))
        elif isinstance(item, str):
            result.append(item)
        else:
            result.append(str(item))
    return result


def format_it(value: float, decimals: int = 6) -> str:
    """Format a float for Italian locale display.

    Uses comma as decimal separator for readability.
    """
    formatted = f"{value:.{decimals}f}"
    # Replace dot with comma for Italian convention
    return formatted.replace(".", ",")
