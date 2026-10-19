"""Deterministic run fingerprint (plan §20.4). Any differing field means no cache reuse."""

from __future__ import annotations

from ..canonical import digest_obj, require_digest

H2_COMMIT = '1cfe254e8d25b15f37048c3730134686abe60335'


def run_fingerprint(*, task_digest: str, base_digest: str, profile_digest: str,
                    evaluator_digest: str, sandbox_digest: str, seed: int,
                    policy_digest: str, h2_commit: str = H2_COMMIT) -> str:
    for name, value in (('task', task_digest), ('base', base_digest),
                        ('profile', profile_digest), ('evaluator', evaluator_digest),
                        ('sandbox', sandbox_digest), ('policy', policy_digest)):
        require_digest(value, name)
    return digest_obj({'task': task_digest, 'base': base_digest, 'profile': profile_digest,
                       'evaluator': evaluator_digest, 'sandbox': sandbox_digest,
                       'h2_commit': h2_commit, 'seed': int(seed), 'policy': policy_digest})
