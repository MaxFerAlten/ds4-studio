"""UT-001..005, UT-014, UT-003 and config hardening."""

import math
from pathlib import Path

import pytest
from pydantic import ValidationError

from h2ds4 import settings as S
from h2ds4.canonical import canonical_json, digest_obj, is_digest
from h2ds4.models import ExperimentCreate, RunEnvelope
from h2ds4.settings import Mode, PolicyError

D = 'sha256:' + 'a' * 64


def test_ut001_default_config_is_off_and_valid(tmp_path, monkeypatch):
    monkeypatch.setenv('XDG_RUNTIME_DIR', str(tmp_path))
    s = S.load(S.DEFAULT_CONFIG)
    assert s.service.mode == Mode.OFF and s.service.enabled is False


def test_ut002_defaults_enable_nothing():
    s = S.Settings()
    assert not s.service.enabled and not s.service.expose_tcp
    assert s.sandbox.required and s.sandbox.network == 'none'
    assert not s.experiment.allow_auto_promotion and s.policy.require_explicit_approval
    assert not s.inference.allow_remote_provider and s.inference.max_inflight == 1


@pytest.mark.parametrize('url', [
    'http://localhost:8002',            # UT-004: symbolic host (DNS rebinding)
    'http://example.com:8002',
    'https://127.0.0.1:8002',
    'http://0.0.0.0:8002',
    'http://169.254.169.254:80',
    'http://10.0.0.5:8002',
    'http://127.0.0.1:8002/secret',
    'http://user:pass@127.0.0.1:8002',
    'http://127.0.0.1:8002?token=x',
    'http://127.0.0.1',                  # no port
])
def test_ut005_remote_model_denied(url):
    with pytest.raises(PolicyError):
        S.validate_model_url(url)


def test_loopback_ok():
    S.validate_model_url('http://127.0.0.1:8002')
    S.validate_model_url('http://[::1]:8002')


@pytest.mark.parametrize('section,key,value', [
    ('inference', 'max_inflight', 2),                 # UT-014
    ('inference', 'allow_remote_provider', True),
    ('service', 'expose_tcp', True),
    ('sandbox', 'network', 'host'),
    ('sandbox', 'required', False),
    ('experiment', 'allow_auto_promotion', True),
    ('policy', 'allow_generated_scripts', True),
    ('policy', 'allowed_components', ['c1', 'c7']),
    ('ds4', 'use_native_agent', True),
    ('ds4', 'allow_runtime_restart', True),
    ('audit', 'store_raw_prompts', True),
])
def test_relaxations_rejected(section, key, value):
    with pytest.raises(PolicyError):
        S.from_mapping({section: {key: value}}).validate()


def test_unknown_keys_and_types_rejected():
    with pytest.raises(PolicyError):
        S.from_mapping({'service': {'mode': 'off', 'surprise': 1}})
    with pytest.raises(PolicyError):
        S.from_mapping({'nope': {}})
    with pytest.raises(PolicyError):
        S.from_mapping({'inference': {'max_inflight': '1'}})
    with pytest.raises(PolicyError):
        S.from_mapping({'service': {'enabled': 'yes'}})


def test_env_overrides_allowlist_only(tmp_path, monkeypatch):
    monkeypatch.setenv('XDG_RUNTIME_DIR', str(tmp_path))
    cfg = tmp_path / 'c.toml'
    cfg.write_text('[service]\nmode = "off"\n')
    s = S.load(cfg, environ={'H2DS4_MODE': 'lab', 'DS4_SKILLS_DIR': '/evil',
                             'H2DS4_EVIL': 'x'})
    assert s.service.mode == Mode.LAB
    with pytest.raises(PolicyError):
        S.load(cfg, environ={'H2DS4_DS4_BASE_URL': 'http://evil.example:80'})


def test_state_inside_ds4_rejected(tmp_path):
    with pytest.raises(PolicyError):
        S.from_mapping({'ds4': {'root': str(tmp_path)},
                        'paths': {'data_dir': str(tmp_path / 'x')}}).validate()


def test_ut003_extra_fields_and_bad_digests_rejected():
    good = dict(task_id='json-001', task_family='json', mode='lab', substrate='scripted_local',
                workspace_fixture_id='json-001', baseline_harness_id=D, model_profile_id=D,
                evaluation_profile_id=D, k=1, run_seed=1)
    ExperimentCreate(**good)
    with pytest.raises(ValidationError):
        ExperimentCreate(**good, shell='rm -rf /')
    with pytest.raises(ValidationError):
        ExperimentCreate(**{**good, 'baseline_harness_id': 'sha256:XYZ'})
    with pytest.raises(ValidationError):
        ExperimentCreate(**{**good, 'task_id': '../../etc'})
    with pytest.raises(ValidationError):
        ExperimentCreate(**{**good, 'k': 3})
    with pytest.raises(ValidationError):
        ExperimentCreate(**{**good, 'k': True})  # strict: bool is not an int


def test_canonical_json_rejects_non_finite():
    with pytest.raises(ValueError):
        canonical_json({'x': math.nan})
    with pytest.raises(ValueError):
        canonical_json({'x': math.inf})
    assert canonical_json({'b': 1, 'a': [1, 2]}) == b'{"a":[1,2],"b":1}'
    assert is_digest(digest_obj({'a': 1}))


def test_run_envelope_digest_and_invariants():
    kw = dict(experiment_id='e', task_fixture_id='t', execution_id='x', substrate='scripted_local',
              model_profile_id=D, base_harness_digest=D, candidate_harness_digest=D,
              evaluator_digest=D, source_digest=D, attempt=1, seed=1,
              hard_deadline_utc='2026-01-01T00:00:00Z', max_model_calls=1, max_input_tokens=1,
              max_output_tokens=1, max_tool_calls=1, max_workspace_bytes=1,
              isolation_profile_id=D)
    a, b = RunEnvelope(**kw), RunEnvelope(**{**kw, 'attempt': 2})
    assert a.digest() != b.digest()
    with pytest.raises(ValueError):
        RunEnvelope(**{**kw, 'attempt': 0})


def test_paths_must_be_absolute():
    with pytest.raises(PolicyError):
        S.from_mapping({'paths': {'data_dir': 'relative/dir'}}).validate()
    assert Path(S.DEFAULT_CONFIG).is_absolute()
