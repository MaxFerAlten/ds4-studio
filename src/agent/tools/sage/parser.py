"""Structured JSON parser for SageMath delimited output."""
import json
from .exceptions import SageResultParseError

RESULT_BEGIN = "__DS4_RESULT_BEGIN__"
RESULT_END = "__DS4_RESULT_END__"


def extract_result_json(stdout: str) -> dict:
    """Extract and parse the JSON payload between delimiters.

    Ignores all text outside the delimiters.
    Raises SageResultParseError if markers are missing or malformed.
    """
    start = stdout.find(RESULT_BEGIN)
    end = stdout.find(RESULT_END)

    if start == -1 or end == -1 or end <= start:
        raise SageResultParseError(
            "Structured result markers not found in stdout"
        )

    payload_start = start + len(RESULT_BEGIN)
    payload = stdout[payload_start:end].strip()

    if not payload:
        raise SageResultParseError("Empty JSON payload between markers")

    try:
        return json.loads(payload)
    except json.JSONDecodeError as exc:
        raise SageResultParseError(f"JSON decode error: {exc}") from exc


def validate_schema(raw: dict) -> list[str]:
    """Validate required top-level keys. Return list of missing keys."""
    required_keys = {"expression", "variable"}
    missing = [k for k in required_keys if k not in raw]
    return missing
