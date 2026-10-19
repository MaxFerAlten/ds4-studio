"""Content scan for candidate harness text (plan §19.2, SEC-014/015/016).

A denylist is a tripwire, not the barrier: the sandbox and the runtime tool policy are
the barrier. Anything this flags makes the candidate invalid; anything it misses still
cannot escape the sandbox.
"""

from __future__ import annotations

import re

_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ('policy override', re.compile(
        r'\b(ignore|disregard|override|bypass|disable)\b[^\n]{0,40}\b('
        r'previous|prior|above|system|safety|guardrails?|sandbox|polic(y|ies)|restrictions?)\b',
        re.I)),
    ('sandbox bypass flag', re.compile(
        r'--dangerously|--no-sandbox|--network[= ]host|--privileged|bypass-approvals', re.I)),
    ('remote fetch / exfiltration', re.compile(
        r'\b(curl|wget|nc|ncat|socat|scp|rsync|ssh)\s+[^\n]*(https?://|\S+@\S+|\d+\.\d+\.\d+\.\d+)',
        re.I)),
    ('destructive shell', re.compile(
        r'\brm\s+-[a-z]*r[a-z]*f|\bmkfs\b|\bdd\s+if=|\bchmod\s+-R\s+777|:\(\)\s*\{', re.I)),
    ('privilege escalation', re.compile(r'\b(sudo|doas|pkexec|setuid)\b', re.I)),
    ('process killing', re.compile(r'\b(killall|pkill|fuser\s+-k)\b', re.I)),
    ('credential paths', re.compile(r'~/\.ssh|\.aws/credentials|\.config/gcloud|id_rsa|/etc/shadow',
                                    re.I)),
    ('DS4 upstream path', re.compile(r'/mnt/crucial_ai/COPARATOR/(ds4|riconciliazione)', re.I)),
    ('inline code execution', re.compile(
        r'\b(eval|exec)\s*\(|\bos\.system\s*\(|\bsubprocess\.|child_process|import\s+os\b', re.I)),
    ('model-written approval', re.compile(r'\b(approved?_by|approval[_ ]token|APPROVED)\s*[:=]',
                                          re.I)),
)


def scan_text(text: str) -> list[str]:
    return [f'forbidden content ({name})' for name, rx in _RULES if rx.search(text)]
