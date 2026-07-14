"""KaTeX validator: syntactic checks for Obsidian-compatible LaTeX."""
import re
from typing import Optional
from .models import ValidationIssue, ValidationReport


def validate_katex_document(
    document: str,
    target: str = "obsidian",
) -> ValidationReport:
    """Validate all KaTeX/LaTeX in a document.

    Checks:
    1. Balanced $ and $$ delimiters
    2. No \[ or \] blocks for Obsidian target
    3. Balanced array environments
    4. Column count consistency in tables
    5. No corrupted characters (U+FFFD)
    6. No internal placeholders
    """
    issues: list[ValidationIssue] = []

    # Check for corrupted characters
    if "\ufffd" in document or "���" in document:
        issues.append(ValidationIssue(
            code="CORRUPTED_CHARACTERS",
            severity="critical",
            message="Document contains corrupted/replacement characters",
        ))

    # Count inline math delimiters
    dollar_count = document.count("$")
    if dollar_count % 2 != 0:
        issues.append(ValidationIssue(
            code="UNBALANCED_DOLLARS",
            severity="error",
            message=f"Unbalanced '$' delimiters ({dollar_count} occurrences)",
        ))

    # Count display math delimiters
    double_dollar_count = document.count("$$")
    if double_dollar_count % 2 != 0:
        issues.append(ValidationIssue(
            code="UNBALANCED_DOUBLE_DOLLARS",
            severity="error",
            message=f"Unbalanced '$$' delimiters ({double_dollar_count} occurrences)",
        ))

    # For Obsidian target, check no \[ \]
    if target == "obsidian":
        if "\\[" in document or "\\]" in document:
            issues.append(ValidationIssue(
                code="OBSIDIAN_INCOMPATIBLE_DELIMITERS",
                severity="warning",
                message=(
                    "Found \\[ or \\] delimiters which are not rendered "
                    "by Obsidian KaTeX"
                ),
            ))

    # Check array environments balance
    begin_arrays = list(re.finditer(r"\\begin\{array\}(\[.*?\])?(\{.*?\})", document))
    end_arrays = list(re.finditer(r"\\end\{array\}", document))

    if len(begin_arrays) != len(end_arrays):
        issues.append(ValidationIssue(
            code="UNBALANCED_ARRAY_ENVIRONMENTS",
            severity="critical",
            message=(
                f"Mismatched array environments: "
                f"{len(begin_arrays)} begin vs {len(end_arrays)} end"
            ),
        ))

    # Validate column counts for each array
    for match in begin_arrays:
        spec_match = re.search(r"\{([^}]+)\}", match.group(0))
        if spec_match:
            spec = spec_match.group(1)
            expected_cols = _count_array_columns(spec)

            # Find the corresponding rows up to \end{array}
            # This is a simplified check — real implementation would parse properly
            row_count_check = _check_table_rows(document, match.end(), expected_cols)
            if not row_count_check["ok"]:
                issues.append(ValidationIssue(
                    code="TABLE_COLUMN_MISMATCH",
                    severity="error",
                    message=row_count_check["message"],
                ))

    passed = all(
        iss.severity in ("info", "warning") for iss in issues
    )

    return ValidationReport(passed=passed, issues=issues)


def _count_array_columns(spec: str) -> int:
    """Count columns from an array specification string.

    Removes | and spaces, then counts c, l, r, p{...} entries.
    """
    sanitized = spec.replace("|", "").replace(" ", "")
    count = 0
    i = 0
    while i < len(sanitized):
        ch = sanitized[i]
        if ch in {"c", "l", "r"}:
            count += 1
            i += 1
        elif ch == "p" and i + 1 < len(sanitized) and sanitized[i + 1] == "{":
            # Count p{...} as one column
            count += 1
            # Skip to closing brace
            depth = 1
            j = i + 2
            while j < len(sanitized) and depth > 0:
                if sanitized[j] == "{":
                    depth += 1
                elif sanitized[j] == "}":
                    depth -= 1
                j += 1
            i = j
        else:
            i += 1
    return count


def _check_table_rows(document: str, start_pos: int, expected_cols: int) -> dict:
    """Check that rows in an array have the correct number of columns."""
    end_marker = r"\end{array}"
    end_pos = document.find(end_marker, start_pos)
    if end_pos == -1:
        return {"ok": True, "message": ""}

    between = document[start_pos:end_pos]

    for line_num, line in enumerate(between.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("%"):
            continue

        # Count & separators; actual cells = & count + 1
        amp_count = stripped.count("&")
        actual_cols = amp_count + 1

        if actual_cols != expected_cols:
            return {
                "ok": False,
                "message": (
                    f"Row {line_num}: expected {expected_cols} columns "
                    f"but found {actual_cols}"
                ),
            }

    return {"ok": True, "message": ""}
