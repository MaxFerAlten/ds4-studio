"""Raw substrate stream -> typed, redacted, capped events (plan §23).

The raw stream is untrusted. Every clipped field records original and kept byte counts
and a digest, so truncation can never read as success. Grader verdicts are never part of
an event: this module has no access to evaluator output.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from ..canonical import digest_bytes
from .redact import REDACTION_VERSION, allowlist, redact

KINDS = frozenset({'llm_request', 'llm_result', 'tool_request', 'tool_result', 'tool_error',
                   'stdout', 'stderr', 'artifact', 'cancel', 'timeout', 'policy_denied',
                   'heartbeat'})


@dataclass(frozen=True)
class Caps:
    excerpt_bytes: int = 4000
    total_bytes: int = 2_000_000
    max_line_bytes: int = 16 * 1024 * 1024


def _excerpt(payload: str, caps: Caps) -> dict:
    raw = payload.encode('utf-8', errors='replace')
    red, n = redact(payload)
    red_b = red.encode('utf-8', errors='replace')
    kept = red_b[:caps.excerpt_bytes].decode('utf-8', errors='ignore')
    return {
        # Hash of the redacted content only: raw payloads may hold secrets (plan §23.1).
        'payload_digest': digest_bytes(red_b),
        'payload_excerpt_redacted': kept,
        'original_bytes': len(raw),
        'kept_bytes': len(kept.encode('utf-8')),
        'truncated': len(red_b) > caps.excerpt_bytes,
        'truncated_bytes': max(0, len(red_b) - caps.excerpt_bytes),
        'redactions': n,
        'source_redacted': True,
    }


def _text_of(value: object) -> str:
    if value is None:
        return ''
    if isinstance(value, str):
        return value
    return json.dumps(value, default=str, ensure_ascii=False, sort_keys=True)


def parse_opencode_jsonl(lines: Iterable[bytes], *, execution_id: str,
                         caps: Caps | None = None) -> Iterator[dict]:
    """OpenCode `--format json` events (same defensive shape as harness2 render_events)."""
    caps = caps or Caps()
    seq = 0
    seen_calls: set[tuple[str, str]] = set()
    total = 0

    def emit(kind: str, payload: str, **extra: object) -> dict:
        nonlocal seq, total
        assert kind in KINDS
        seq += 1
        ev = {'v': 1, 'execution_id': execution_id, 'seq': seq, 'kind': kind,
              'source': 'opencode-jsonl', 'redaction_version': REDACTION_VERSION,
              **extra, **_excerpt(payload, caps)}
        total += ev['kept_bytes']
        return allowlist(ev)

    for raw in lines:
        if total >= caps.total_bytes:
            yield emit('policy_denied', 'trace byte cap reached; remaining events dropped',
                       ok=False)
            return
        if len(raw) > caps.max_line_bytes:
            yield emit('stderr', f'oversized event line ({len(raw)} bytes) dropped', ok=False)
            continue
        line = raw.decode('utf-8', errors='replace').strip()
        if not line.startswith('{'):
            if line:
                yield emit('stdout', line)
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            yield emit('stderr', 'malformed JSON event line', ok=False)
            continue
        if not isinstance(ev, dict):
            continue
        err = ev.get('error')
        if isinstance(err, dict):
            msg = (err.get('data') or {}).get('message') or err.get('message') or _text_of(err)
            yield emit('tool_error', _text_of(msg), ok=False)
            continue
        part: dict = ev['part'] if isinstance(ev.get('part'), dict) else ev
        ptype = part.get('type', ev.get('type'))
        if ptype in ('text', 'reasoning'):
            txt = part.get('text') or part.get('content')
            if isinstance(txt, str) and txt.strip():
                yield emit('llm_result', txt, ok=True)
        elif ptype in ('tool', 'tool_use', 'tool_call', 'tool-invocation'):
            name = str(part.get('tool') or ev.get('tool') or part.get('name')
                       or (part.get('toolInvocation') or {}).get('toolName') or 'tool')[:80]
            call_id = str(part.get('callID') or part.get('id') or part.get('tool_call_id')
                          or f'seq{seq + 1}')[:120]
            state: dict = part['state'] if isinstance(part.get('state'), dict) else part
            status = state.get('status', '')
            key = (call_id, str(status))
            if key in seen_calls:
                continue  # dedupe repeated status snapshots of the same call
            seen_calls.add(key)
            tin = state.get('input') or part.get('input') or part.get('args')
            tout = state.get('output') or state.get('result') or part.get('output')
            yield emit('tool_request', _text_of(tin), tool_name=name, tool_call_id=call_id)
            if status == 'error':
                yield emit('tool_error', _text_of(state.get('error')), tool_name=name,
                           tool_call_id=call_id, ok=False)
            elif tout is not None:
                yield emit('tool_result', _text_of(tout), tool_name=name, tool_call_id=call_id,
                           ok=True)
        elif ptype in ('step_finish', 'step-finish'):
            yield emit('heartbeat', _text_of(part.get('tokens') or {}), ok=True)


def render(events: Iterable[dict], *, max_chars: int) -> str:
    """Normalised events -> the shared [ACTION]/[OBSERVATION]/[ERROR] grammar."""
    out: list[str] = []
    for ev in events:
        body = ev.get('payload_excerpt_redacted', '')
        if ev.get('truncated'):
            body += f" [...clipped {ev.get('truncated_bytes', 0)} bytes; not evidence of success]"
        kind = ev.get('kind')
        if kind == 'llm_result':
            out.append(f'[ASSISTANT] {body}')
        elif kind == 'tool_request':
            out.append(f"[ACTION] {ev.get('tool_name', 'tool')}({body})")
        elif kind == 'tool_result':
            out.append(f'[OBSERVATION] {body}')
        elif kind in ('tool_error', 'policy_denied', 'timeout', 'cancel'):
            out.append(f'[ERROR] {body}')
        elif kind in ('stdout', 'stderr'):
            out.append(f'[OBSERVATION] {body}')
    text = '\n'.join(out).strip() or '(no parseable events in trajectory)'
    if len(text) > max_chars:
        dropped = len(text) - max_chars
        text = text[:max_chars] + f'\n[... {dropped} chars clipped from trajectory]'
    return text
