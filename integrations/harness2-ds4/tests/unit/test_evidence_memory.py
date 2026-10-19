"""WP06 (UT-019, SEC-026) and WP14 (UT-012, conflicts, cross-model, TTL, caps)."""

import json

import pytest

from h2ds4.canonical import digest_obj
from h2ds4.evidence.normalize import Caps, parse_opencode_jsonl, render
from h2ds4.evidence.redact import redact
from h2ds4.memory.library import ExperienceLibrary, Lesson
from h2ds4.store.sqlite import SqliteStore

FAKE = {
    'openai': 'sk-' + 'A1b2C3d4E5f6G7h8I9j0K1l2',
    'gh': 'ghp_' + 'a' * 36,
    'aws': 'AKIA' + 'ABCDEFGHIJKLMNOP',
    'jwt': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXZhbHVl',
}


def test_ut019_redaction_of_fake_secrets():
    text = ' '.join(FAKE.values()) + ' API_KEY=supersecret password: hunter2 ' \
        'https://bob:pw@host/x mail me@example.org'
    out, n = redact(text)
    for v in (*FAKE.values(), 'supersecret', 'hunter2', 'bob:pw', 'me@example.org'):
        assert v not in out
    assert n >= 8


def _line(obj) -> bytes:
    return json.dumps(obj).encode()


def test_parse_events_redacts_dedupes_and_never_carries_verdicts():
    lines = [
        _line({'type': 'text', 'part': {'type': 'text', 'text': f'key {FAKE["openai"]}'}}),
        _line({'type': 'tool_use', 'part': {'type': 'tool', 'tool': 'bash', 'callID': 'c1',
                                            'state': {'status': 'completed', 'input': {'cmd': 'env'},
                                                      'output': f'TOKEN={FAKE["gh"]}'}}}),
        _line({'type': 'tool_use', 'part': {'type': 'tool', 'tool': 'bash', 'callID': 'c1',
                                            'state': {'status': 'completed', 'input': {'cmd': 'env'},
                                                      'output': 'dup'}}}),
        b'{not json',
        b'plain stdout line',
        _line({'error': {'message': 'boom'}}),
    ]
    evs = list(parse_opencode_jsonl(lines, execution_id='x'))
    blob = json.dumps(evs)
    assert FAKE['openai'] not in blob and FAKE['gh'] not in blob
    kinds = [e['kind'] for e in evs]
    assert kinds.count('tool_request') == 1  # status snapshot deduplicated
    assert 'stderr' in kinds and 'stdout' in kinds and 'tool_error' in kinds
    assert all(set(e) <= {'v', 'execution_id', 'seq', 'kind', 'tool_name', 'tool_call_id', 'ok',
                          'duration_ms', 'payload_digest', 'payload_excerpt_redacted', 'source',
                          'truncated', 'truncated_bytes', 'original_bytes', 'kept_bytes',
                          'redaction_version', 'redactions', 'source_redacted'} for e in evs)
    assert 'score' not in blob and 'verdict' not in blob


def test_sec026_huge_observation_clipped_with_true_length():
    big = 'x' * (10 * 1024 * 1024)
    lines = [_line({'type': 'tool_use', 'part': {'type': 'tool', 'tool': 'read', 'callID': 'c',
                                                 'state': {'status': 'completed', 'input': {},
                                                           'output': big}}})]
    evs = list(parse_opencode_jsonl(lines, execution_id='x', caps=Caps(excerpt_bytes=1000)))
    res = [e for e in evs if e['kind'] == 'tool_result'][0]
    assert res['truncated'] and res['original_bytes'] == len(big)
    assert res['kept_bytes'] <= 1000 and res['truncated_bytes'] == len(big) - 1000
    txt = render(evs, max_chars=50_000)
    assert 'not evidence of success' in txt


def test_total_trace_cap_emits_policy_event():
    lines = [_line({'type': 'text', 'part': {'type': 'text', 'text': 'y' * 500}})] * 50
    evs = list(parse_opencode_jsonl(lines, execution_id='x',
                                    caps=Caps(excerpt_bytes=500, total_bytes=2000)))
    assert evs[-1]['kind'] == 'policy_denied' and len(evs) < 10


D1, D2 = 'sha256:' + '1' * 64, 'sha256:' + '2' * 64


def L(**kw):
    base = dict(domain='json', profile_family='fam-a', cue='When JSON does not parse',
                lesson='strip trailing commas', failure_mode='parse', verdict='helped',
                evidence_digest=D1, source_overlay_digest=D2, score_delta=0.3, tags=('json',))
    base.update(kw)
    return Lesson(**base)


@pytest.fixture
def lib(private):
    return ExperienceLibrary(SqliteStore(private / 's.sqlite3').initialize(), ttl_days=90,
                             max_entries=2000)


def test_ut012_dedup_not_independent_evidence(lib):
    a = lib.add(L())
    b = lib.add(L(lesson='Strip  TRAILING commas!'))  # same normalised lesson
    assert b['deduplicated'] and a['id'] == b['id']
    with lib.store.read() as db:
        assert db.execute('SELECT observed_on_tasks FROM experience_entries').fetchone()[0] == 2


def test_conflict_marked_not_latest_wins(lib):
    lib.add(L())
    c = lib.add(L(lesson='never strip commas', verdict='hurt'))
    assert c['state'] == 'CONFLICT'
    with lib.store.read() as db:
        assert {r[0] for r in db.execute('SELECT state FROM experience_entries')} == {'CONFLICT'}
    assert lib.retrieve('json', 'fam-a')['items'] == []


def test_cross_model_is_candidate_only_and_caps(lib):
    for i in range(10):
        lib.add(L(lesson=f'lesson number {i} ' + 'z' * 300, cue=f'cue {i}'), validated=True)
    same = lib.retrieve('json', 'fam-a', max_items=5, max_chars=6000)
    assert len(same['items']) == 5 and same['chars'] <= 6000
    assert all('UNTRUSTED_EXPERIENCE' in i['text'] for i in same['items'])
    other = lib.retrieve('json', 'fam-b', max_items=3, max_chars=1000)
    assert all(i['state'] == 'CROSS_MODEL_UNVALIDATED' for i in other['items'])
    assert other['chars'] <= 1000
    assert lib.retrieve('ledger', 'fam-a')['items'] == []  # domain segregation


def test_ttl_and_invalidation(lib):
    lib.ttl_days = -1
    lib.add(L())
    assert lib.expire() == 1
    lib.ttl_days = 90
    lib.add(L(cue='other cue', lesson='other lesson'))
    assert lib.invalidate_profile('fam-a', 'tool protocol changed') == 1
    assert lib.retrieve('json', 'fam-a')['items'] == []


def test_capacity_2k_and_redaction_in_lessons(lib):
    lib.max_entries = 3
    lib.add(L(lesson=f'use {FAKE["openai"]} carefully', cue='c1'))
    lib.add(L(lesson='b', cue='c2'))
    lib.add(L(lesson='c', cue='c3'))
    with pytest.raises(ValueError):
        lib.add(L(lesson='d', cue='c4'))
    with lib.store.read() as db:
        assert FAKE['openai'] not in json.dumps([dict(r) for r in
                                                 db.execute('SELECT * FROM experience_entries')])
    assert digest_obj([1]) != digest_obj([2])


def test_2000_entries_retrieval_bounded(lib):
    for i in range(2000):
        lib.add(L(lesson=f'l{i}', cue=f'c{i}', tags=('t',) if i % 2 else ()))
    r = lib.retrieve('json', 'fam-a', tags=('t',), max_items=5, max_chars=6000)
    assert len(r['items']) == 5
