"""Experiment state machine (plan §14, §31.2). APPROVED is an overlay state, never here."""

from __future__ import annotations

RUNNING = ('QUEUED', 'PREFLIGHT', 'BASELINE', 'PROPOSING', 'PROBING', 'COMPOSING', 'EVALUATING')
TERMINAL = ('QUARANTINED', 'REJECTED', 'FAILED', 'CANCELLED')

ALLOWED: dict[str, set[str]] = {
    'CREATED': {'QUEUED', 'CANCEL_REQUESTED'},
    'QUEUED': {'PREFLIGHT', 'FAILED', 'CANCEL_REQUESTED'},
    'PREFLIGHT': {'BASELINE', 'FAILED', 'CANCEL_REQUESTED'},
    'BASELINE': {'PROPOSING', 'REJECTED', 'FAILED', 'CANCEL_REQUESTED'},
    'PROPOSING': {'PROBING', 'FAILED', 'CANCEL_REQUESTED'},
    'PROBING': {'COMPOSING', 'FAILED', 'CANCEL_REQUESTED'},
    'COMPOSING': {'EVALUATING', 'FAILED', 'CANCEL_REQUESTED'},
    'EVALUATING': {'QUARANTINED', 'REJECTED', 'FAILED', 'CANCEL_REQUESTED'},
    'CANCEL_REQUESTED': {'CANCELLED'},
    'CANCELLED': set(),
    'FAILED': set(),
    'REJECTED': set(),
    'QUARANTINED': set(),
}


def assert_transition(old: str, new: str) -> None:
    if new not in ALLOWED.get(old, set()):
        raise ValueError(f'INVALID_TRANSITION:{old}->{new}')
