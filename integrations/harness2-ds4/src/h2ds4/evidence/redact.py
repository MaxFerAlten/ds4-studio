"""Secret/PII redaction (plan §23, §28). Field allowlist first, patterns second."""

from __future__ import annotations

import re

REDACTION_VERSION = 'redact-v1'

_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ('private_key', re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----',
                               re.S)),
    ('bearer', re.compile(r'(?i)\bbearer\s+[a-z0-9._~+/=-]{8,}')),
    ('api_key', re.compile(r'\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b')),
    ('anthropic_key', re.compile(r'\bsk-ant-[A-Za-z0-9_-]{16,}\b')),
    ('github_token', re.compile(r'\bgh[pousr]_[A-Za-z0-9]{20,}\b')),
    ('aws_access_key', re.compile(r'\b(AKIA|ASIA)[0-9A-Z]{16}\b')),
    ('google_api_key', re.compile(r'\bAIza[0-9A-Za-z_-]{35}\b')),
    ('slack_token', re.compile(r'\bxox[abprs]-[A-Za-z0-9-]{10,}\b')),
    ('jwt', re.compile(r'\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b')),
    ('assignment', re.compile(
        r'(?i)\b([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|CREDENTIAL)'
        r'[A-Z0-9_]*)\s*[=:]\s*("[^"\n]*"|\'[^\'\n]*\'|\S+)')),
    ('url_credentials', re.compile(r'(?i)\b([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@')),
    ('email', re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b')),
)


def redact(text: str) -> tuple[str, int]:
    """Return (redacted text, number of redactions)."""
    count = 0
    out = text
    for name, rx in _PATTERNS:
        if name == 'assignment':
            out, n = rx.subn(lambda m: f'{m.group(1)}=[REDACTED:secret]', out)
        elif name == 'url_credentials':
            out, n = rx.subn(lambda m: f'{m.group(1)}[REDACTED:cred]@', out)
        else:
            out, n = rx.subn(f'[REDACTED:{name}]', out)
        count += n
    return out, count


SAFE_FIELDS = frozenset({
    'v', 'execution_id', 'seq', 'kind', 'tool_name', 'tool_call_id', 'ok', 'duration_ms',
    'payload_digest', 'payload_excerpt_redacted', 'source', 'truncated', 'truncated_bytes',
    'original_bytes', 'kept_bytes', 'redaction_version', 'redactions', 'source_redacted',
})


def allowlist(event: dict) -> dict:
    return {k: v for k, v in event.items() if k in SAFE_FIELDS}
