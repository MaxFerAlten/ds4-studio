import os
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'fixtures'))


@pytest.fixture
def private(tmp_path: Path) -> Path:
    d = tmp_path / 'p'
    d.mkdir(mode=0o700)
    os.chmod(d, 0o700)
    return d


@pytest.fixture(scope='session')
def sandbox_ok() -> bool:
    from h2ds4.sandbox.bwrap import preflight
    return preflight()['ok']


@pytest.fixture
def need_sandbox(sandbox_ok: bool) -> None:
    if not sandbox_ok:
        pytest.skip('SKIPPED_UNVERIFIED: bwrap/userns/systemd scope unavailable on this host')


@pytest.fixture
def lab(private: Path, need_sandbox):
    from h2ds4.lab import make_lab
    return make_lab(private / 'lab', upstream_roots=[])
