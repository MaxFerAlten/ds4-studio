from types import SimpleNamespace

import pytest

from h2ds4.benchmarks import ab
from h2ds4.errors import Code, H2DS4Error


def _fake_lab(tmp_path):
    fixture = SimpleNamespace(split='dev', family='json', tags=())
    return SimpleNamespace(fixtures_root=tmp_path), fixture


def _patch_single_fixture(monkeypatch, lab, fixture):
    monkeypatch.setattr(ab, 'DS4_DEFAULT_ROOTS', ())
    monkeypatch.setattr(ab, 'make_lab', lambda *args, **kwargs: lab)
    monkeypatch.setattr(ab, 'list_fixtures', lambda _: ['json-001'])
    monkeypatch.setattr(ab, 'load_fixture', lambda *_: fixture)


def test_run_ab_fails_closed_when_sandbox_rejects_task(monkeypatch, tmp_path):
    lab, fixture = _fake_lab(tmp_path)
    _patch_single_fixture(monkeypatch, lab, fixture)
    monkeypatch.setattr(ab, 'run_experiment', lambda *args, **kwargs: {
        'id': 'exp-1', 'state': 'FAILED',
        'decision': {'reason': 'SANDBOX_UNAVAILABLE: cgroup_scope=false'},
    })
    output = tmp_path / 'ab-report'

    with pytest.raises(H2DS4Error) as raised:
        ab.run_ab(split='all', k_values=(1,), output=output)

    assert raised.value.code == Code.SANDBOX_UNAVAILABLE
    assert not output.with_suffix('.json').exists()


def test_run_ab_rejects_incomplete_evidence_instead_of_zero_filling(monkeypatch, tmp_path):
    lab, fixture = _fake_lab(tmp_path)
    lab.service = SimpleNamespace(evidence=lambda _: {})
    _patch_single_fixture(monkeypatch, lab, fixture)
    monkeypatch.setattr(ab, 'run_experiment', lambda *args, **kwargs: {
        'id': 'exp-1', 'state': 'DONE',
    })

    with pytest.raises(H2DS4Error, match='incomplete') as raised:
        ab.run_ab(split='all', k_values=(1,))

    assert raised.value.code == Code.INTERNAL_ERROR


def test_ab_metric_rejects_missing_values():
    with pytest.raises(H2DS4Error, match='missing metric'):
        ab._metric({}, 'pass_rate')
