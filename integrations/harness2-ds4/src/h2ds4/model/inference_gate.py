"""Single in-flight inference gate (plan §18, §31.3).

Protects only requests routed through the sidecar; it proves nothing about DS4 UI
traffic. A job must hold a maintenance-window acknowledgement before acquiring. After an
uncertain backend outcome (timeout mid-request) the gate refuses new permits until an
operator resets it: an expired permit never authorises a second concurrent request.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from ..errors import Code, H2DS4Error


@dataclass
class Permit:
    experiment_id: str
    profile_digest: str
    acquired_monotonic: float


class InferenceGate:
    def __init__(self, *, inflight: int = 1):
        if inflight != 1:
            raise ValueError('single local model supports one inflight')
        self._lock = threading.Lock()
        self._state = threading.Lock()
        self._active: Permit | None = None
        self._uncertain = False
        self.max_observed_inflight = 0
        self._inflight = 0

    @property
    def uncertain(self) -> bool:
        return self._uncertain

    def acquire(self, exp: str, profile: str, *, timeout_s: float = 5.0) -> Permit:
        if self._uncertain:
            raise H2DS4Error(Code.MODEL_BUSY, 'MODEL_UNCERTAIN: manual recovery required')
        if not self._lock.acquire(timeout=timeout_s):
            raise H2DS4Error(Code.MODEL_BUSY, 'MODEL_BUSY')
        if self._uncertain:
            self._lock.release()
            raise H2DS4Error(Code.MODEL_BUSY, 'MODEL_UNCERTAIN: manual recovery required')
        with self._state:
            self._inflight += 1
            self.max_observed_inflight = max(self.max_observed_inflight, self._inflight)
            self._active = Permit(exp, profile, time.monotonic())
            return self._active

    def release(self, permit: Permit, *, uncertain: bool = False) -> None:
        with self._state:
            if self._active is not permit or not self._lock.locked():
                raise RuntimeError('permit ownership violation')
            self._active = None
            self._inflight -= 1
            if uncertain:
                self._uncertain = True
        self._lock.release()

    def reset_uncertain(self) -> None:
        """Operator action after verifying the backend is idle again."""
        self._uncertain = False

    @contextmanager
    def permit(self, exp: str, profile: str, *, timeout_s: float = 5.0) -> Iterator[Permit]:
        p = self.acquire(exp, profile, timeout_s=timeout_s)
        uncertain = False
        try:
            yield p
        except H2DS4Error as e:
            uncertain = e.code == Code.DEADLINE_EXCEEDED
            raise
        finally:
            self.release(p, uncertain=uncertain)
