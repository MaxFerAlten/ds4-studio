"""One experiment end to end (plan §20.1, §21): PREFLIGHT -> H2 k-recursion -> EVALUATING
-> gate -> QUARANTINED | REJECTED.

The baseline is always a candidate; anything uncertain keeps it. The upstream DS4
fingerprint is taken before and after: any change fails the experiment and is reported,
never repaired.
"""

from __future__ import annotations

import json
import threading
import traceback
import uuid
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path

from harness2.core import tree as HT
from harness2.core.schedule import run_task
from harness2.core.spec import ChannelSpec

from ..canonical import digest_bytes, digest_obj, tree_digest
from ..errors import Code, H2DS4Error
from ..evidence.evaluator import EvalOutcome, evaluate
from ..memory.library import ExperienceLibrary, Lesson
from ..model.inference_gate import InferenceGate
from ..model.openai_client import OpenAIClient
from ..model.proxy import InferenceProxy, ProxyContext
from ..models import RunEnvelope
from ..overlay import manifest as M
from ..overlay.stage import stage_overlay
from ..policy import mutation
from ..policy.promotion import Decision, Scores, decide
from ..registry import resolve_fixture, resolve_harness, resolve_profile
from ..sandbox.bwrap import BwrapSandbox, Limits
from ..sandbox.bwrap import preflight as sandbox_preflight
from ..settings import Mode, Settings
from ..store.blobs import BlobStore
from ..store.sqlite import SqliteStore, utc_after, utcnow
from ..substrates.base import ExecutionResult
from ..substrates.opencode_local import OpencodeLocalSubstrate
from ..substrates.scripted_local import ScriptedLocalSubstrate
from ..upstream import fingerprint, snapshot_digest
from .budgets import Budget
from .h2_adapter import (
    DS4_SURFACE,
    Ds4BenchAdapter,
    Ds4LocalProposer,
    ScriptedProposer,
    label_of,
    tree_to_bytes,
)

PHASES = ('PREFLIGHT', 'BASELINE', 'PROPOSING', 'PROBING', 'COMPOSING', 'EVALUATING')


def _phase_for_rollout(label: str) -> str:
    return 'BASELINE' if label.startswith('base') else \
        'PROBING' if label.startswith(('inv', 'dom')) else 'COMPOSING'


def _phase_for_call(label: str) -> str:
    return 'PROPOSING' if label.startswith(('inv', 'dom')) else 'COMPOSING'


class Engine:
    def __init__(self, settings: Settings, store: SqliteStore, blobs: BlobStore,
                 fixtures_root: Path, *, gate: InferenceGate | None = None,
                 sandbox: BwrapSandbox | None = None,
                 upstream_roots: list[Path] | None = None,
                 client_factory: Callable[[], OpenAIClient] | None = None):
        self.s = settings
        self.store = store
        self.blobs = blobs
        self.fixtures_root = fixtures_root
        self.gate = gate or InferenceGate()
        sb = settings.sandbox
        self.limits = Limits(wall_s=float(settings.experiment.max_task_wall_s),
                             memory_mib=sb.memory_max_mib, pids_max=sb.pids_max,
                             cpu_quota_pct=sb.cpu_quota_pct, workspace_mib=sb.workspace_max_mib)
        self.sandbox = sandbox or BwrapSandbox(settings.cache_dir, self.limits)
        if upstream_roots is None:
            upstream_roots = [Path(settings.ds4.root),
                              *(Path(p) for p in settings.ds4.protected_roots)]
        self.upstream_roots = [p for p in upstream_roots if (p / '.git').exists()]
        self.client_factory = client_factory or (lambda: OpenAIClient(
            settings.ds4.base_url, settings.ds4.model_id,
            read_timeout_s=settings.inference.request_timeout_s))
        self.library = ExperienceLibrary(store, ttl_days=settings.memory.ttl_days,
                                         max_entries=settings.memory.max_index_entries)
        self._phase_lock = threading.Lock()

    # -- state helpers -------------------------------------------------------------------
    def _row(self, exp_id: str):
        with self.store.read() as db:
            row = db.execute('SELECT * FROM experiments WHERE id=?', (exp_id,)).fetchone()
        if row is None:
            raise H2DS4Error(Code.NOT_FOUND, 'experiment not found')
        return row

    def _move(self, exp_id: str, new: str, *, error_code: str | None = None,
              decision: dict | None = None) -> None:
        with self.store.tx() as db:
            row = db.execute('SELECT state, revision FROM experiments WHERE id=?',
                             (exp_id,)).fetchone()
            self.store.compare_swap_state(db, exp_id, row['state'], row['revision'], new,
                                          error_code=error_code)
            if decision is not None:
                db.execute('UPDATE experiments SET decision_json=? WHERE id=?',
                           (json.dumps(decision, sort_keys=True), exp_id))
            self.store.audit(db, actor='h2ds4', action=f'state-{new.lower()}', target=exp_id,
                             outcome=error_code or 'ok')

    def _advance(self, exp_id: str, target: str) -> None:
        """Forward-only phase progress driven from H2 callbacks (threads)."""
        with self._phase_lock:
            cur = self._row(exp_id)['state']
            if cur not in PHASES or PHASES.index(target) <= PHASES.index(cur):
                return
            for step in PHASES[PHASES.index(cur) + 1:PHASES.index(target) + 1]:
                self._move(exp_id, step)

    def _cancel_requested(self, exp_id: str) -> bool:
        with self.store.read() as db:
            row = db.execute('SELECT cancel_requested FROM jobs WHERE experiment_id=?',
                             (exp_id,)).fetchone()
        return bool(row and row['cancel_requested'])

    # -- run -----------------------------------------------------------------------------
    def execute(self, exp_id: str) -> dict:
        try:
            return self._execute(exp_id)
        except H2DS4Error as e:
            return self._fail(exp_id, str(e.code), e.detail)
        except Exception as e:  # worker must survive a task failure
            return self._fail(exp_id, 'INTERNAL_ERROR',
                              f'{type(e).__name__}: {traceback.format_exc()[-400:]}')

    def _fail(self, exp_id: str, code: str, detail: str) -> dict:
        state = self._row(exp_id)['state']
        if self._cancel_requested(exp_id) and state not in ('CANCELLED', 'FAILED'):
            return self._finish_cancel(exp_id)
        if state not in ('FAILED', 'QUARANTINED', 'REJECTED', 'CANCELLED', 'CANCEL_REQUESTED'):
            self._move(exp_id, 'FAILED', error_code=code,
                       decision={'decision': 'KEEP_BASE', 'reason': f'{code}: {detail}'[:400]})
        return {'state': 'FAILED', 'error': code}

    def _finish_cancel(self, exp_id: str) -> dict:
        if self._row(exp_id)['state'] != 'CANCEL_REQUESTED':
            self._move(exp_id, 'CANCEL_REQUESTED')
        self._move(exp_id, 'CANCELLED', decision={'decision': 'KEEP_BASE',
                                                  'reason': 'cancelled'})
        return {'state': 'CANCELLED'}

    def _execute(self, exp_id: str) -> dict:
        exp = self._row(exp_id)
        if exp['state'] != 'QUEUED':
            raise H2DS4Error(Code.CONFLICT, f'experiment is {exp["state"]}')
        self._move(exp_id, 'PREFLIGHT')
        mode = self.s.service.mode
        allowed = {Mode.LAB: ('lab',), Mode.PROPOSE: ('lab', 'propose'),
                   Mode.APPROVED: ('lab', 'propose')}.get(mode, ())
        if exp['mode'] not in allowed:
            raise H2DS4Error(Code.POLICY_DENIED, f'service mode {mode} forbids {exp["mode"]}')
        fixture, evaluator, eval_digest = resolve_fixture(self.store, self.fixtures_root,
                                                          exp['task_id'])
        if eval_digest != exp['evaluator_id']:
            raise H2DS4Error(Code.INTEGRITY_FAILURE, 'evaluator changed since creation')
        base_tree = resolve_harness(self.store, self.blobs, exp['base_overlay_id'])
        mutation.check_tree(base_tree, base_tree)
        profile = resolve_profile(self.store, exp['profile_id'])
        sp = sandbox_preflight()
        if not sp['ok']:
            raise H2DS4Error(Code.SANDBOX_UNAVAILABLE, json.dumps(sp['checks']))
        before = [fingerprint(r) for r in self.upstream_roots]
        e = self.s.experiment
        budget = Budget.from_limits(wall_s=e.max_task_wall_s, model_calls=e.max_model_calls,
                                    tool_calls=e.max_tool_calls,
                                    input_tokens=e.max_total_input_tokens,
                                    output_tokens=e.max_total_output_tokens)
        work = self.s.cache_dir / 'experiments' / exp_id
        work.mkdir(parents=True, exist_ok=True)
        proxy = client = None
        ctx: ProxyContext | None = None
        substrate: ScriptedLocalSubstrate | OpencodeLocalSubstrate
        if exp['substrate'] == 'scripted_local':
            substrate = ScriptedLocalSubstrate(self.sandbox)
        elif exp['substrate'] == 'opencode_local':
            substrate = OpencodeLocalSubstrate(self.sandbox, model_id=self.s.ds4.model_id)
            pre = substrate.preflight()
            if not pre['ready']:
                raise H2DS4Error(Code.CAPABILITY_MISSING, '; '.join(pre['blockers'])[:300])
        else:
            raise H2DS4Error(Code.BLOCKED_API, 'ds4_native substrate is BLOCKED_API')
        try:
            if substrate.name == 'opencode_local':
                client = self.client_factory()
                client.require_model()
                ctx = ProxyContext(upstream=client.http, model_id=self.s.ds4.model_id,
                                   gate=self.gate, budget=budget, experiment_id=exp_id,
                                   profile_digest=exp['profile_id'],
                                   max_request_bytes=self.s.inference.max_request_bytes)
                proxy = InferenceProxy(self.s.runtime_dir / f'inf-{exp_id[:8]}.sock', ctx).start()
            self._move(exp_id, 'BASELINE')
            runs: dict[str, tuple[ExecutionResult, str]] = {}

            def executor(fx, harness, rid):
                return substrate.execute(fx, harness, rid, proxy=ctx)

            def on_rollout(run_id: str, result: ExecutionResult, harness: dict) -> None:
                runs[run_id] = (result, tree_digest(harness))
                self._record_run(exp, fixture, run_id, result, harness, profile.digest(),
                                 eval_digest, budget)

            adapter = Ds4BenchAdapter(
                fixture=fixture, base_tree={k: v.decode() for k, v in base_tree.items()},
                work_root=work, executor=executor, on_rollout=on_rollout,
                progress=lambda lbl: self._advance(exp_id, _phase_for_rollout(lbl)),
                cancelled=lambda: self._cancel_requested(exp_id))
            channel = ChannelSpec('opencode', f'ds4/{profile.model_id}')
            def on_call(lbl: str) -> None:
                if not lbl.startswith(('select.', 'experience.')):
                    self._advance(exp_id, _phase_for_call(lbl))
            if substrate.name == 'scripted_local':
                prop = ScriptedProposer(channel, fixture.scripted['edit'], on_call=on_call,
                                        cancelled=lambda: self._cancel_requested(exp_id))
            else:
                assert client is not None
                prop = Ds4LocalProposer(
                    channel, client, gate=self.gate, budget=budget, experiment_id=exp_id,
                    profile_digest=exp['profile_id'],
                    max_context_chars=self.s.memory.max_context_chars * 4,
                    max_output_tokens=4096, on_call=on_call,
                    cancelled=lambda: self._cancel_requested(exp_id))
            res = run_task(fixture.id, exp['k'], adapter=adapter, prop=prop,
                           runs_root=adapter.spec.runs_root, modes=('agg',), seed=exp['seed'],
                           library=None)
        finally:
            if proxy is not None:
                proxy.stop()
            if client is not None:
                client.close()
        if self._cancel_requested(exp_id):
            return self._finish_cancel(exp_id)
        after = [fingerprint(r) for r in self.upstream_roots]
        if before != after:
            with self.store.tx() as db:
                self.store.audit(db, actor='h2ds4', action='integrity-check-failed',
                                 target=exp_id, outcome='upstream-changed',
                                 detail={'before': before, 'after': after})
            raise H2DS4Error(Code.INTEGRITY_FAILURE, 'DS4 upstream changed during experiment')
        rd = res.to_dict()
        if res.status == 'base-failed':
            raise H2DS4Error(Code.UPSTREAM_UNAVAILABLE, 'no base rollout produced anything')
        self._advance(exp_id, 'EVALUATING')
        sel = rd.get('selections', {}).get('agg', {})
        chosen = sel.get('chosen_label') or ''
        base_ids = [b['run_id'] for b in rd.get('base', [])]
        cand_id = next((rid for rid in runs if label_of(rid) == chosen), None)
        outcomes = {rid: self._evaluate(exp, rid, runs[rid][0], evaluator, eval_digest)
                    for rid in [*base_ids, *([cand_id] if cand_id else [])] if rid in runs}
        base_scores = self._scores([outcomes[r] for r in base_ids if r in outcomes],
                                   [runs[r][0] for r in base_ids if r in runs],
                                   profile.digest(), eval_digest)
        decision_extra: dict = {'selection': {k: sel.get(k) for k in
                                              ('chosen_label', 'chosen_tree_is_base', 'ok')},
                                'ledger': (rd.get('modes', {}).get('agg') or {}).get('ledger')}
        if not chosen or cand_id is None:
            gate_decision, reason = Decision.INCONCLUSIVE, 'selection produced no candidate'
            cand_scores = None
        else:
            cand_scores = self._scores([outcomes[cand_id]], [runs[cand_id][0]],
                                       profile.digest(), eval_digest)
            if sel.get('chosen_tree_is_base'):
                gate_decision, reason = Decision.KEEP_BASE, 'selection kept the base harness'
            elif ctx is not None and ctx.profile_mismatch:
                gate_decision, reason = Decision.INCONCLUSIVE, 'model switched while probing'
            else:
                g = decide(base_scores, cand_scores, min_gain=self.s.policy.minimum_quality_gain,
                           tolerance=self.s.policy.regression_tolerance,
                           max_token_ratio=self.s.policy.max_token_ratio)
                gate_decision, reason = g.decision, g.reason
        decision = {'decision': str(gate_decision), 'reason': reason,
                    'baseline': asdict(base_scores),
                    'candidate': asdict(cand_scores) if cand_scores else None,
                    'outcomes': {label_of(k): v.metrics() for k, v in outcomes.items()},
                    'proxy': ctx.totals() if ctx else {'usage_source': 'none'},
                    **decision_extra}
        if gate_decision == Decision.QUARANTINE and cand_id is not None:
            cand_tree = self._chosen_tree(adapter, rd, chosen)
            mutation.check_tree(cand_tree, base_tree)
            decision['overlay'] = self._quarantine(exp, cand_tree, base_tree, decision,
                                                   snapshot_digest(before), profile, fixture)
            self._move(exp_id, 'QUARANTINED', decision=decision)
        else:
            self._move(exp_id, 'REJECTED', decision=decision)
        self._write_report(exp_id, decision)
        return {'state': self._row(exp_id)['state'], **decision}

    def _chosen_tree(self, adapter: Ds4BenchAdapter, rd: dict, chosen: str) -> dict[str, bytes]:
        run_id = rd['base'][0]['run_id']
        ns_dir = Path(adapter.spec.runs_root) / run_id.split('/')[0] / \
            run_id.split('/')[1].replace('/', '__')
        return tree_to_bytes(HT.read_tree(DS4_SURFACE, ns_dir / 'harnesses' / chosen))

    def _record_run(self, exp, fixture, run_id: str, result: ExecutionResult,
                    harness: dict[str, bytes], profile_digest: str, eval_digest: str,
                    budget: Budget) -> None:
        sb = result.sandbox
        status = 'TIMED_OUT' if sb.timed_out else 'SUCCEEDED' if sb.returncode == 0 else 'FAILED'
        e = self.s.experiment
        env = RunEnvelope(
            experiment_id=exp['id'], task_fixture_id=fixture.id, execution_id=result.run_id,
            substrate=exp['substrate'], model_profile_id=profile_digest,
            base_harness_digest=exp['base_overlay_id'],
            candidate_harness_digest=tree_digest(harness), evaluator_digest=eval_digest,
            source_digest=fixture.source_digest, attempt=1, seed=exp['seed'],
            hard_deadline_utc=utc_after(budget.remaining_s()), max_model_calls=e.max_model_calls,
            max_input_tokens=e.max_total_input_tokens,
            max_output_tokens=e.max_total_output_tokens, max_tool_calls=e.max_tool_calls,
            max_workspace_bytes=self.limits.workspace_mib << 20,
            isolation_profile_id=sb.isolation_profile_id)
        trace = digest_bytes(''.join(json.dumps(ev, sort_keys=True) + '\n'
                                     for ev in result.events).encode())
        deliv = digest_obj({d: digest_bytes(sb.workspace[d]) for d in fixture.deliverables
                            if d in sb.workspace})
        u = result.usage
        with self.store.tx() as db:
            db.execute(
                'INSERT INTO runs (id, experiment_id, label, harness_digest, workspace_digest, '
                'model_profile_id, envelope_digest, status, attempt, started_utc, finished_utc,'
                ' token_in, token_out, usage_source, model_calls, tool_calls, duration_ms, '
                'trace_digest, deliverable_digest, failure_code) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (str(uuid.uuid4()), exp['id'], label_of(run_id), tree_digest(harness),
                 tree_digest(sb.workspace), profile_digest, env.digest(), status, 1, None,
                 utcnow(), u.get('input_tokens'), u.get('output_tokens'),
                 u.get('usage_source'), u.get('model_calls', 0),
                 sum(1 for ev in result.events if ev.get('kind') == 'tool_request'),
                 sb.wall_ms, trace, deliv, None if status == 'SUCCEEDED' else status))
            self.store.audit(db, actor='h2ds4', action='run-finished', target=exp['id'],
                             outcome=status, detail={'label': label_of(run_id),
                                                     'envelope': env.digest()})

    def _evaluate(self, exp, run_id: str, result: ExecutionResult, evaluator,
                  eval_digest: str) -> EvalOutcome:
        out = evaluate(evaluator, result, sandbox=self.sandbox)
        with self.store.tx() as db:
            rid = db.execute('SELECT id FROM runs WHERE experiment_id=? AND label=? '
                             'ORDER BY attempt DESC LIMIT 1',
                             (exp['id'], label_of(run_id))).fetchone()['id']
            db.execute('INSERT OR IGNORE INTO evaluations VALUES (?,?,?,?,?,?,?,?)',
                       (str(uuid.uuid4()), exp['id'], rid, eval_digest,
                        json.dumps(out.metrics(), sort_keys=True), out.verdict,
                        out.provenance(evaluator, result), utcnow()))
        return out

    @staticmethod
    def _scores(outs: list[EvalOutcome], results: list[ExecutionResult], profile: str,
                evaluator: str) -> Scores:
        n = len(outs)
        sources = {r.usage.get('usage_source', 'unknown') for r in results}
        return Scores(
            pass_rate=sum(o.success for o in outs) / n if n else 0.0,
            quality=sum(o.quality for o in outs) / n if n else 0.0,
            input_tokens=sum(int(r.usage.get('input_tokens') or 0) for r in results),
            output_tokens=sum(int(r.usage.get('output_tokens') or 0) for r in results),
            hard_failures=sum(o.hard_failures for o in outs),
            security_violations=sum(o.security_violations for o in outs),
            critical_regressions=0, score_count=n, profile_digest=profile,
            evaluator_digest=evaluator,
            usage_source=sources.pop() if len(sources) == 1 else 'unknown')

    def _quarantine(self, exp, cand: dict[str, bytes], base: dict[str, bytes], decision: dict,
                    snapshot: str, profile, fixture) -> dict:
        evidence = digest_obj({'decision': decision['decision'],
                               'outcomes': decision['outcomes']})
        man = M.build(cand, parent_digest=tree_digest(base), ds4_snapshot_digest=snapshot,
                      model_profile_digest=profile.digest(), evidence_digest=evidence,
                      experiment_id=exp['id'])
        stage_overlay(self.s.data_dir, cand, man)
        oid = 'ov-' + man['overlay_digest'][7:23]
        changed = sorted(p for p in cand if base.get(p) != cand[p])
        with self.store.tx() as db:
            db.execute('INSERT OR IGNORE INTO overlay_versions (id, digest, parent_id, state, '
                       'manifest_json, created_utc) VALUES (?,?,?,?,?,?)',
                       (oid, man['overlay_digest'], None, 'QUARANTINED',
                        json.dumps(man, sort_keys=True), utcnow()))
            db.execute('INSERT OR IGNORE INTO candidates VALUES (?,?,?,?,?,?,?,?)',
                       (str(uuid.uuid4()), exp['id'], man['overlay_digest'], tree_digest(base),
                        'VALID', json.dumps({'decision': decision['decision'],
                                             'reason': decision['reason'],
                                             'changed': changed}, sort_keys=True),
                        evidence, utcnow()))
            self.store.audit(db, actor='h2ds4', action='candidate-quarantined', target=oid,
                             outcome='QUARANTINED', detail={'experiment': exp['id'],
                                                            'digest': man['overlay_digest']})
        gain = decision['candidate']['quality'] - decision['baseline']['quality']
        skills = [p.split('/')[1] for p in changed if p.startswith('skills/')]
        self.library.add(Lesson(
            domain=fixture.family, profile_family=profile.family(),
            cue=fixture.scripted.get('edit', {}).get('trigger') or fixture.work,
            lesson=f'Changed {", ".join(changed)}; skills {skills}', failure_mode='baseline-fail'
            if decision['baseline']['pass_rate'] < 1 else 'quality', verdict='helped',
            evidence_digest=evidence, source_overlay_digest=man['overlay_digest'],
            score_delta=round(gain, 6), tags=tuple(fixture.tags)))
        return {'overlay_id': oid, 'digest': man['overlay_digest'], 'changed': changed}

    def _write_report(self, exp_id: str, decision: dict) -> None:
        d = self.s.data_dir / 'reports'
        d.mkdir(mode=0o700, exist_ok=True)
        (d / f'{exp_id}.json').write_text(json.dumps(decision, indent=2, sort_keys=True),
                                          encoding='utf-8')
        (d / f'{exp_id}.json').chmod(0o600)
