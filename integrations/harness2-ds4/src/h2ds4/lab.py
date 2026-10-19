"""Self-contained local lab: a private state directory, the scripted substrate, the real
sandbox, the real engine and gate. Used by `h2ds4 demo`, the A/B runner and tests.
Never touches the user's XDG state or any DS4 path.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from . import registry as R
from .evidence.evaluator import EvalOutcome, evaluate
from .fixtures import TaskFixture, load_evaluator, load_fixture
from .models import ExperimentCreate
from .orchestration.engine import Engine
from .orchestration.scheduler import Worker
from .policy.paths import ensure_private_dir
from .service import MAINTENANCE_ACK, Service
from .settings import Settings, from_mapping
from .store.blobs import BlobStore
from .store.sqlite import SqliteStore
from .substrates.scripted_local import ScriptedLocalSubstrate

FIXTURES = Path(__file__).resolve().parents[2] / 'fixtures'


@dataclass
class Lab:
    settings: Settings
    store: SqliteStore
    blobs: BlobStore
    service: Service
    engine: Engine
    worker: Worker
    base_harness_id: str
    profile_id: str
    fixtures_root: Path


def make_lab(root: Path, *, mode: str = 'propose', fixtures_root: Path = FIXTURES,
             upstream_roots: list[Path] | None = None, extra: dict | None = None) -> Lab:
    root = ensure_private_dir(root)
    cfg: dict[str, dict] = {'service': {'enabled': True, 'mode': mode},
           'paths': {'runtime_dir': str(root / 'run'), 'data_dir': str(root / 'data'),
                     'cache_dir': str(root / 'cache')}}
    for k, v in (extra or {}).items():
        cfg.setdefault(k, {}).update(v)
    s = from_mapping(cfg).validate()
    for d in (s.runtime_dir, s.data_dir, s.cache_dir):
        ensure_private_dir(d)
    store = SqliteStore(s.db_path).initialize()
    blobs = BlobStore(s.data_dir / 'blob')
    service = Service(s, store, blobs, fixtures_root)
    engine = Engine(s, store, blobs, fixtures_root, upstream_roots=upstream_roots)
    hid = R.register_harness(store, blobs, R.load_base_harness())
    pid = R.register_profile(store, R.SCRIPTED_PROFILE)
    return Lab(s, store, blobs, service, engine, Worker(store, engine), hid, pid, fixtures_root)


def run_experiment(lab: Lab, task_id: str, *, k: int = 1, seed: int = 42,
                   mode: Literal['lab', 'propose'] = 'lab') -> dict:
    reg = R.register_fixture(lab.store, lab.fixtures_root, task_id)
    req = ExperimentCreate(task_id=task_id, task_family=reg['family'], mode=mode,
                           substrate='scripted_local', workspace_fixture_id=task_id,
                           baseline_harness_id=lab.base_harness_id,
                           model_profile_id=lab.profile_id,
                           evaluation_profile_id=reg['evaluation_profile_id'], k=k,
                           run_seed=seed)
    created = lab.service.create_experiment(req, f'create-{task_id}-{k}-{seed}')
    lab.service.queue_run(created['id'], f'run-{task_id}-{k}-{seed}',
                          maintenance_ack=MAINTENANCE_ACK)
    lab.worker.run_once()
    return {'id': created['id'], **lab.service.get_experiment(created['id'])}


def run_lab(root: Path, task_ids: list[str], *, k: int = 1) -> list[dict]:
    lab = make_lab(root)
    return [{k2: r[k2] for k2 in ('id', 'task_id', 'state', 'decision', 'runs')}
            for r in (run_experiment(lab, t, k=k) for t in task_ids)]


def evaluate_harness(lab: Lab, fixture: TaskFixture, harness: dict[str, bytes],
                     run_id: str) -> EvalOutcome:
    """One rollout of `harness` on `fixture` plus deterministic evaluation (no recursion)."""
    sub = ScriptedLocalSubstrate(lab.engine.sandbox)
    res = sub.execute(fixture, harness, run_id)
    return evaluate(load_evaluator(lab.fixtures_root, fixture.evaluator_id), res,
                    sandbox=lab.engine.sandbox)


def fixture(lab: Lab, task_id: str) -> TaskFixture:
    return load_fixture(lab.fixtures_root, task_id)
