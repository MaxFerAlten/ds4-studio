"""Experience library, separate from DS4 transcripts and KV (plan §24, ADR-006).

- keyed by (domain, profile_family, lesson_digest): duplicates merge, never double count;
- a lesson with the same cue but a contradictory verdict marks both CONFLICT (no
  "latest wins");
- confidence derives from validations and task count, never from model text;
- other model families get the entry only as CROSS_MODEL_UNVALIDATED;
- deterministic tag retrieval, hard caps on items and characters, UNTRUSTED delimiters;
- TTL expiry retires entries; approved overlay manifests are never touched.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import uuid
from dataclasses import dataclass

from ..canonical import digest_obj, require_digest
from ..evidence.redact import redact
from ..store.sqlite import SqliteStore, utcnow

_WORD = re.compile(r'[a-z0-9]+')


def _norm(text: str) -> str:
    return ' '.join(_WORD.findall(text.lower()))


@dataclass(frozen=True)
class Lesson:
    domain: str
    profile_family: str
    cue: str
    lesson: str
    failure_mode: str
    verdict: str  # helped | hurt | no_effect
    evidence_digest: str
    source_overlay_digest: str
    score_delta: float | None
    tags: tuple[str, ...] = ()

    def digest(self) -> str:
        return digest_obj({'cue': _norm(self.cue), 'lesson': _norm(self.lesson),
                           'failure_mode': _norm(self.failure_mode), 'verdict': self.verdict})


def _confidence(observed: int, validated: bool) -> float:
    base = 0.5 if validated else 0.2
    return round(min(0.95, base + 0.1 * (observed - 1)), 3)


class ExperienceLibrary:
    def __init__(self, store: SqliteStore, *, ttl_days: int = 90, max_entries: int = 2000):
        self.store = store
        self.ttl_days = ttl_days
        self.max_entries = max_entries

    def add(self, lesson: Lesson, *, validated: bool = False) -> dict:
        if lesson.verdict not in ('helped', 'hurt', 'no_effect'):
            raise ValueError('verdict must be helped|hurt|no_effect')
        require_digest(lesson.evidence_digest, 'evidence_digest')
        require_digest(lesson.source_overlay_digest, 'source_overlay_digest')
        cue, _ = redact(lesson.cue[:400])
        text, _ = redact(lesson.lesson[:1200])
        ldig = lesson.digest()
        expires = (dt.datetime.now(dt.UTC) + dt.timedelta(days=self.ttl_days)).strftime(
            '%Y-%m-%dT%H:%M:%S.%fZ')
        with self.store.tx() as db:
            row = db.execute('SELECT * FROM experience_entries WHERE domain=? AND '
                             'profile_family=? AND lesson_digest=?',
                             (lesson.domain, lesson.profile_family, ldig)).fetchone()
            if row is not None:
                observed = row['observed_on_tasks'] + 1
                state = row['state'] if row['state'] == 'CONFLICT' else (
                    'VALIDATED' if validated or row['state'] == 'VALIDATED' else row['state'])
                db.execute('UPDATE experience_entries SET observed_on_tasks=?, confidence=?, '
                           'state=?, expires_utc=? WHERE id=?',
                           (observed, _confidence(observed, state == 'VALIDATED'), state,
                            expires, row['id']))
                return {'id': row['id'], 'deduplicated': True, 'state': state}
            n = db.execute('SELECT COUNT(*) FROM experience_entries WHERE state != ?',
                           ('RETIRED',)).fetchone()[0]
            if n >= self.max_entries:
                raise ValueError('experience library full; compact first')
            state = 'VALIDATED' if validated else 'QUARANTINED'
            cue_key = _norm(lesson.cue)
            clash = [r for r in db.execute(
                'SELECT id, cue, tags_json FROM experience_entries WHERE domain=? AND '
                'profile_family=? AND state != ?', (lesson.domain, lesson.profile_family,
                                                    'RETIRED'))
                     if _norm(r['cue']) == cue_key
                     and json.loads(r['tags_json']).get('verdict') != lesson.verdict]
            if clash:
                state = 'CONFLICT'
                for r in clash:
                    db.execute('UPDATE experience_entries SET state=? WHERE id=?',
                               ('CONFLICT', r['id']))
            eid = str(uuid.uuid4())
            db.execute(
                'INSERT INTO experience_entries (id, domain, profile_family, '
                'source_overlay_digest, evidence_digest, lesson_digest, failure_mode, cue, '
                'lesson, tags_json, score_delta, confidence, observed_on_tasks, state, '
                'expires_utc, created_utc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (eid, lesson.domain, lesson.profile_family, lesson.source_overlay_digest,
                 lesson.evidence_digest, ldig, lesson.failure_mode[:200], cue, text,
                 json.dumps({'tags': sorted(lesson.tags), 'verdict': lesson.verdict}),
                 lesson.score_delta, _confidence(1, validated), 1, state, expires, utcnow()))
            self.store.audit(db, actor='h2ds4', action='experience-added', target=eid,
                             outcome=state, detail={'domain': lesson.domain})
        return {'id': eid, 'deduplicated': False, 'state': state}

    def retrieve(self, domain: str, profile_family: str, *, tags: tuple[str, ...] = (),
                 max_items: int = 5, max_chars: int = 6000) -> dict:
        now = utcnow()
        with self.store.read() as db:
            rows = [dict(r) for r in db.execute(
                'SELECT * FROM experience_entries WHERE domain=? AND state IN (?,?,?) '
                'AND expires_utc > ?', (domain, 'VALIDATED', 'QUARANTINED',
                                        'CROSS_MODEL_UNVALIDATED', now))]
        want = set(tags)

        def rank(r: dict) -> tuple:
            same = r['profile_family'] == profile_family
            overlap = len(want & set(json.loads(r['tags_json'])['tags']))
            return (not same, r['state'] != 'VALIDATED', -overlap, -(r['confidence'] or 0),
                    r['created_utc'], r['id'])

        items: list[dict] = []
        used = 0
        for r in sorted(rows, key=rank):
            if len(items) >= max_items:
                break
            state = r['state'] if r['profile_family'] == profile_family \
                else 'CROSS_MODEL_UNVALIDATED'
            block = (f'<UNTRUSTED_EXPERIENCE state="{state}" evidence="{r["evidence_digest"]}">'
                     f'\ncue: {r["cue"]}\nlesson: {r["lesson"]}\n</UNTRUSTED_EXPERIENCE>')
            if used + len(block) > max_chars:
                break
            used += len(block)
            items.append({'id': r['id'], 'state': state, 'text': block,
                          'evidence_digest': r['evidence_digest']})
        return {'items': items, 'chars': used, 'text': '\n'.join(i['text'] for i in items)}

    def expire(self) -> int:
        with self.store.tx() as db:
            cur = db.execute('UPDATE experience_entries SET state=? WHERE state != ? AND '
                             'expires_utc <= ?', ('RETIRED', 'RETIRED', utcnow()))
            return cur.rowcount

    def invalidate_profile(self, profile_family: str, reason: str) -> int:
        """Tool protocol or policy changed for a model family: retire its lessons."""
        with self.store.tx() as db:
            cur = db.execute('UPDATE experience_entries SET state=? WHERE profile_family=? '
                             'AND state != ?', ('RETIRED', profile_family, 'RETIRED'))
            self.store.audit(db, actor='h2ds4', action='experience-invalidated',
                             target=profile_family, outcome=str(cur.rowcount),
                             detail={'reason': reason[:200]})
            return cur.rowcount
