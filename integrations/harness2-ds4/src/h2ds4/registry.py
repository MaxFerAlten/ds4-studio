"""Pre-authorised registry: requests carry only ids, resolved here (plan §12, WP04)."""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from .canonical import canonical_json, digest_obj, tree_digest
from .errors import Code, H2DS4Error
from .fixtures import EvaluationProfile, TaskFixture, load_evaluator, load_fixture
from .models import ModelProfile
from .policy.paths import read_tree_nofollow
from .store.blobs import BlobStore
from .store.sqlite import SqliteStore, utcnow

BASE_HARNESS_DIR = Path(__file__).resolve().parents[2] / 'config' / 'base-harness'


def register_fixture(store: SqliteStore, fixtures_root: Path, task_id: str) -> dict:
    fx = load_fixture(fixtures_root, task_id)
    ev = load_evaluator(fixtures_root, fx.evaluator_id)
    with store.tx() as db:
        row = db.execute('SELECT source_digest FROM task_fixtures WHERE id=?', (fx.id,)).fetchone()
        if row is not None and row['source_digest'] != fx.source_digest:
            raise H2DS4Error(Code.CONFLICT, 'fixture changed since registration; use a new id')
        if row is None:
            db.execute('INSERT INTO task_fixtures VALUES (?,?,?,?,?)',
                       (fx.id, fx.family, json.dumps({'evaluator_digest': ev.digest,
                                                      'evaluator_id': ev.id}),
                        fx.source_digest, utcnow()))
        db.execute('INSERT OR IGNORE INTO evaluation_profiles VALUES (?,?,?)',
                   (ev.digest, json.dumps({'id': ev.id}), utcnow()))
        store.audit(db, actor='operator', action='fixture-registered', target=fx.id,
                    outcome='ok', detail={'source_digest': fx.source_digest})
    return {'task_id': fx.id, 'family': fx.family, 'source_digest': fx.source_digest,
            'evaluation_profile_id': ev.digest}


def resolve_fixture(store: SqliteStore, fixtures_root: Path,
                    task_id: str) -> tuple[TaskFixture, EvaluationProfile, str]:
    with store.read() as db:
        row = db.execute('SELECT * FROM task_fixtures WHERE id=?', (task_id,)).fetchone()
    if row is None:
        raise H2DS4Error(Code.NOT_FOUND, 'fixture not registered')
    fx = load_fixture(fixtures_root, task_id)
    if fx.source_digest != row['source_digest']:
        raise H2DS4Error(Code.INTEGRITY_FAILURE, 'fixture source digest mismatch')
    spec = json.loads(row['spec_json'])
    ev = load_evaluator(fixtures_root, spec['evaluator_id'])
    if ev.digest != spec['evaluator_digest']:
        raise H2DS4Error(Code.INTEGRITY_FAILURE, 'evaluator digest mismatch')
    return fx, ev, ev.digest


def load_base_harness(path: Path = BASE_HARNESS_DIR) -> dict[str, bytes]:
    return read_tree_nofollow(path, max_files=64, max_bytes=1 << 20)


def register_harness(store: SqliteStore, blobs: BlobStore, tree: dict[str, bytes]) -> str:
    hid = tree_digest(tree)
    blob = blobs.put(canonical_json({k: v.decode('utf-8') for k, v in tree.items()}))
    with store.tx() as db:
        db.execute('INSERT OR IGNORE INTO harnesses VALUES (?,?,?)', (hid, blob, utcnow()))
    return hid


def resolve_harness(store: SqliteStore, blobs: BlobStore, hid: str) -> dict[str, bytes]:
    with store.read() as db:
        row = db.execute('SELECT blob_digest FROM harnesses WHERE id=?', (hid,)).fetchone()
    if row is None:
        raise H2DS4Error(Code.NOT_FOUND, 'harness not registered')
    tree = {k: v.encode('utf-8') for k, v in json.loads(blobs.get(row['blob_digest'])).items()}
    if tree_digest(tree) != hid:
        raise H2DS4Error(Code.INTEGRITY_FAILURE, 'harness digest mismatch')
    return tree


def register_profile(store: SqliteStore, profile: ModelProfile) -> str:
    pid = profile.digest()
    with store.tx() as db:
        db.execute('INSERT OR IGNORE INTO model_profiles VALUES (?,?,?)',
                   (pid, json.dumps(asdict(profile), sort_keys=True), utcnow()))
    return pid


def resolve_profile(store: SqliteStore, pid: str) -> ModelProfile:
    with store.read() as db:
        row = db.execute('SELECT content_json FROM model_profiles WHERE id=?', (pid,)).fetchone()
    if row is None:
        raise H2DS4Error(Code.NOT_FOUND, 'model profile not registered')
    profile = ModelProfile(**json.loads(row['content_json']))
    if profile.digest() != pid:
        raise H2DS4Error(Code.INTEGRITY_FAILURE, 'model profile digest mismatch')
    return profile


SCRIPTED_PROFILE = ModelProfile(
    backend='none', model_id='scripted-local', gguf_sha256='none', quantization='none',
    ctx_size=0, tokenizer_id='none', tool_protocol='none', runtime_build='h2ds4-scripted-v1',
    sampler_profile='deterministic')


def policy_digest(settings_policy: object) -> str:
    return digest_obj(asdict(settings_policy))  # type: ignore[call-overload]
