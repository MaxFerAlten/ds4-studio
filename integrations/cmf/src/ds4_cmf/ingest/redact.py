"""Deterministic, versioned redaction applied before anything is persisted.

This is a best-effort filter for common credential shapes, not a PII
detector (docs/M1-acceptance.md).  The revision is stored with every event
so a future rule change is visible and replayable.
"""

from __future__ import annotations

import re

REVISION = "redact-v1"

_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("PEM", re.compile(
        r"-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|CERTIFICATE|OPENSSH PRIVATE KEY)-----"
        r".*?-----END [A-Z0-9 ]*-----", re.S)),
    ("AUTH_HEADER", re.compile(r"(?i)\b(authorization|proxy-authorization)\s*:\s*[^\r\n]+")),
    ("BEARER", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}")),
    ("API_KEY", re.compile(
        r"\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"
        r"|xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|hf_[A-Za-z0-9]{20,}"
        r"|glpat-[A-Za-z0-9_-]{20,})")),
    ("ASSIGNMENT", re.compile(
        r"(?i)\b([A-Za-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)"
        r"[A-Za-z0-9_]*)(\s*[:=]\s*)(\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s\"']+)")),
    ("URL_CREDENTIALS", re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://)[^\s/:@]+:[^\s/@]+@")),
)


def redact_text(text: str, *, revision: str = REVISION) -> str:
    if revision != REVISION:
        raise ValueError(f"unknown redaction revision {revision}")
    for kind, rule in _RULES:
        if kind == "ASSIGNMENT":
            text = rule.sub(lambda m: f"{m.group(1)}{m.group(2)}[REDACTED:SECRET]", text)
        elif kind == "AUTH_HEADER":
            text = rule.sub(lambda m: f"{m.group(1)}: [REDACTED:AUTH_HEADER]", text)
        elif kind == "URL_CREDENTIALS":
            text = rule.sub(lambda m: f"{m.group(1)}[REDACTED:URL_CREDENTIALS]@", text)
        else:
            text = rule.sub(f"[REDACTED:{kind}]", text)
    return text
