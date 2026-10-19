"""L4 Harness² conformance, substrate status, CLI exit codes, OFF equivalence, live (opt-in)."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from h2ds4.cli import main
from h2ds4.evidence.fingerprint import H2_COMMIT
from h2ds4.substrates.ds4_native import Ds4NativeSubstrate
from h2ds4.substrates.opencode_local import OpencodeLocalSubstrate, compose_agents_md

REPO = Path(__file__).resolve().parents[2]
VENDOR = REPO / 'vendor' / 'harness2'


def test_vendor_pinned_and_unmodified():
    head = subprocess.run(['git', '-C', str(VENDOR), 'rev-parse', 'HEAD'], capture_output=True,
                          text=True, check=True).stdout.strip()
    assert head == H2_COMMIT
    dirty = subprocess.run(['git', '-C', str(VENDOR), 'status', '--porcelain',
                            '--untracked-files=no'], capture_output=True, text=True).stdout
    assert dirty == ''  # no tracked file of the Google code was edited


def test_upstream_unit_tests_pass():
    r = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s',
                        str(VENDOR / 'tests'), '-p', 'test_*.py'], capture_output=True, text=True,
                       timeout=300, cwd=VENDOR)
    assert r.returncode == 0, r.stderr[-2000:]


def test_upstream_demo_k1_without_model(tmp_path):
    r = subprocess.run([str(Path(sys.executable).parent / 'harness2-demo'), '--output',
                        str(tmp_path / 'demo'), '--k', '1', '--mode', 'parallel'],
                       capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stderr[-1000:]
    d = json.loads((tmp_path / 'demo' / 'demo.json').read_text())
    assert d['failed'] == 0 and d['done'] == 2


def test_selection_pool_excludes_baseline_documented_gap():
    """Upstream regression kept intentionally: the finals-only pool never holds the base.
    The DS4 post-selection gate (policy/promotion.py) reintroduces the baseline."""
    from harness2.core import selection
    from harness2.core.spec import RunView
    base = [RunView('base1', 'r/base1', Path('/x'), True, True)]
    rollouts = {'base1': base[0], 'agg1': RunView('agg1', 'r/agg1', Path('/y'), True, True)}
    pool = selection.selection_pool('agg', 1, rollouts, base)
    assert 'base1' not in pool and 'agg1' in pool


def test_opencode_substrate_unverified_and_isolated_config():
    s = OpencodeLocalSubstrate(None, model_id='m', binary='/missing/opencode')  # type: ignore[arg-type]
    pre = s.preflight()
    assert pre['ready'] is False and pre['status'] == 'UNVERIFIED'
    assert any('digest is not approved' in blocker for blocker in pre['blockers'])
    assert not any('offline provider resolution' in blocker for blocker in pre['blockers'])
    cfg = s.config()
    assert cfg['provider']['ds4']['options']['baseURL'].startswith('http://127.0.0.1:')
    assert cfg['autoupdate'] is False and cfg['share'] == 'disabled'
    assert cfg['provider']['ds4']['models']['m']['limit'] == {
        'context': 550000, 'output': s.max_output_tokens}
    md = compose_agents_md({'systemprompt.md': b'S', 'guardrails.md': b'G',
                            'skills/a/SKILL.md': b'---\nname: a\ndescription: does a\n---\n'})
    assert 'S' in md and '`a`: does a' in md
    if s.binary:
        assert all(not p.startswith(str(Path.home() / '.ssh')) for p in s.toolchain())


def test_opencode_preflight_accepts_only_pinned_binary_digest(tmp_path, monkeypatch):
    import hashlib

    from h2ds4.substrates import opencode_local

    binary = tmp_path / 'opencode'
    binary.write_bytes(b'approved test executable')
    digest = hashlib.sha256(binary.read_bytes()).hexdigest()
    monkeypatch.setattr(opencode_local, 'APPROVED_OPENCODE_SHA256', digest)
    substrate = OpencodeLocalSubstrate(None, model_id='m', binary=str(binary))  # type: ignore[arg-type]

    result = substrate.preflight()
    assert result['ready'] and result['status'] == 'VERIFIED'
    assert result['opencode_sha256'] == digest


def test_native_substrate_blocked_api():
    pre = Ds4NativeSubstrate().preflight()
    assert pre['ready'] is False and pre['status'] == 'BLOCKED_API'
    assert any(b['status'] == 'BLOCKED_API' for b in pre['blockers'])


def test_cli_exit_codes(tmp_path, capsys):
    assert main(['--help']) == 0
    assert main(['nope']) == 2
    assert main(['demo', '--fixture', 'json-002']) == 3  # model demo unsupported
    cfg = tmp_path / 'bad.toml'
    cfg.write_text('[inference]\nmax_inflight = 2\n')
    assert main(['--config', str(cfg), 'capability', 'list']) == 4
    assert main(['--config', '/nonexistent/h2ds4.toml', 'capability', 'list']) == 10


def test_cli_preflight_refuses_report_inside_ds4(tmp_path):
    repo = tmp_path / 'r'
    repo.mkdir()
    subprocess.run(['git', 'init', '-q', str(repo)], check=True)
    assert main(['preflight', '--ds4-root', str(repo), '--output', str(repo / 'x.json')]) == 4
    assert not (repo / 'x.json').exists()
    assert main(['preflight', '--ds4-root', str(repo), '--output',
                 str(tmp_path / 'ok.json')]) == 0
    rep = json.loads((tmp_path / 'ok.json').read_text())
    assert rep['discovery']['capabilities']['per_request_skill_override'] == 'false'


def test_cli_demo_no_model(capsys, need_sandbox):
    assert main(['demo', '--no-model', '--fixture', 'json-002']) == 0
    out = json.loads(capsys.readouterr().out)
    assert out[0]['decision']['decision'] == 'QUARANTINE_CANDIDATE'


def test_off_equivalence_no_ds4_hook(tmp_path, monkeypatch):
    """G03/G04: nothing in DS4 starts the sidecar; the default config refuses to serve."""
    for root in (Path('/mnt/crucial_ai/COPARATOR/ds4'),
                 Path('/mnt/crucial_ai/COPARATOR/riconciliazione-ds4-studio/ds4-studio')):
        srun = root / 'srun.sh'
        if srun.exists():
            assert 'h2ds4' not in srun.read_text(errors='replace')
    from h2ds4.settings import DEFAULT_CONFIG, load
    monkeypatch.setenv('XDG_RUNTIME_DIR', str(tmp_path))
    s = load(DEFAULT_CONFIG)
    assert s.service.enabled is False and str(s.service.mode) == 'off'


@pytest.mark.model_live
@pytest.mark.skipif(os.environ.get('H2DS4_LIVE') != '1',
                    reason='SKIPPED_UNVERIFIED: needs a loaded DS4 model and an explicit '
                           'maintenance window (H2DS4_LIVE=1)')
def test_l5_live_model_smoke():
    from h2ds4.model.capabilities import probe_live
    from h2ds4.model.openai_client import OpenAIClient
    from h2ds4.settings import load
    s = load()
    c = OpenAIClient(s.ds4.base_url, s.ds4.model_id, read_timeout_s=120)
    out = probe_live(c)
    assert out['capabilities']['chat'] == 'true'


@pytest.mark.model_live
@pytest.mark.skipif(os.environ.get('H2DS4_LIVE') != '1',
                    reason='SKIPPED_UNVERIFIED: requires a loaded DS4 model and maintenance window')
def test_l5_opencode_local_proxy_smoke(tmp_path):
    from h2ds4.fixtures import TaskFixture
    from h2ds4.model.inference_gate import InferenceGate
    from h2ds4.model.openai_client import OpenAIClient
    from h2ds4.model.proxy import InferenceProxy, ProxyContext
    from h2ds4.orchestration.budgets import Budget
    from h2ds4.registry import load_base_harness
    from h2ds4.sandbox.bwrap import BwrapSandbox

    model_id = os.environ['H2DS4_MODEL_ID']
    base_url = os.environ.get('H2DS4_DS4_BASE_URL', 'http://127.0.0.1:8002')
    client = OpenAIClient(base_url, model_id, read_timeout_s=180)
    client.require_model()
    budget = Budget.from_limits(wall_s=240, model_calls=16, tool_calls=64,
                                input_tokens=100000, output_tokens=24000)
    ctx = ProxyContext(upstream=client.http, model_id=model_id, gate=InferenceGate(),
                       budget=budget, experiment_id='l5-opencode-smoke',
                       profile_digest='l5-opencode-smoke')
    fixture = TaskFixture(id='l5-smoke', family='smoke', work='write one short file',
                          prompt='Create answer.txt containing exactly OK and nothing else.',
                          workspace={}, deliverables=('answer.txt',), evaluator_id='smoke')
    substrate = OpencodeLocalSubstrate(BwrapSandbox(tmp_path / 'cache'), model_id=model_id)
    with InferenceProxy(tmp_path / 'inference.sock', ctx):
        result = substrate.execute(fixture, load_base_harness(), 'l5smoke', proxy=ctx)

    assert result.ok
    assert 'answer.txt' in result.sandbox.workspace
    assert result.events  # OpenCode JSONL was parsed
    assert ctx.totals()['model_calls'] > 0 and not ctx.denied
