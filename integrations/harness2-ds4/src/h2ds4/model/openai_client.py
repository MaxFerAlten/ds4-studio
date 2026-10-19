"""Strict OpenAI-compatible client for the local DS4 server (plan §15, §33.2).

Only numeric-loopback http URLs (validated by Settings), no environment proxies, no
redirects. Tool calls returned by the model are data: this client never executes them.
POST requests are never retried (non-idempotent); GET retries are bounded.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator
from typing import Any

import httpx

from ..canonical import digest_bytes
from ..errors import Code, H2DS4Error
from ..models import NormalizedModelResponse, Usage
from ..settings import validate_model_url


def make_http_client(base_url: str, *, read_timeout_s: float) -> httpx.Client:
    validate_model_url(base_url)
    timeout = httpx.Timeout(connect=3, read=read_timeout_s, write=10, pool=3)
    return httpx.Client(base_url=base_url, timeout=timeout, follow_redirects=False,
                        trust_env=False)


class OpenAIClient:
    def __init__(self, base_url: str, model_id: str, *, read_timeout_s: float = 1800,
                 http: httpx.Client | None = None, get_retries: int = 2):
        self.http = http or make_http_client(base_url, read_timeout_s=read_timeout_s)
        self.model_id = model_id
        self.get_retries = get_retries
        self.cancelled = threading.Event()

    def close(self) -> None:
        self.http.close()

    # -- discovery ---------------------------------------------------------------------
    def list_models(self) -> list[str]:
        last: Exception | None = None
        for attempt in range(self.get_retries + 1):
            try:
                r = self.http.get('/v1/models')
            except httpx.TransportError as e:
                raise H2DS4Error(Code.UPSTREAM_UNAVAILABLE, type(e).__name__) from e
            if r.status_code in (429, 503) and attempt < self.get_retries:
                time.sleep(min(2.0, 0.2 * 2 ** attempt))
                last = H2DS4Error(Code.MODEL_BUSY, f'HTTP {r.status_code}')
                continue
            _no_redirect(r)
            if r.status_code != 200:
                raise H2DS4Error(Code.UPSTREAM_UNAVAILABLE, f'HTTP {r.status_code}')
            data = _json(r)
            models: list[str] = [x['id'] for x in data.get('data', [])
                                 if isinstance(x, dict) and isinstance(x.get('id'), str)]
            return models
        assert last is not None
        raise last

    def require_model(self) -> None:
        if not self.model_id:
            raise H2DS4Error(Code.PROFILE_MISMATCH, 'model_id not configured')
        if self.model_id not in self.list_models():
            raise H2DS4Error(Code.PROFILE_MISMATCH, 'MODEL_ID_MISMATCH')

    # -- chat --------------------------------------------------------------------------
    def chat(self, messages: list[dict], *, max_tokens: int, tools: list[dict] | None = None,
             tool_choice: str | None = None, temperature: float | None = None,
             stream: bool = False) -> NormalizedModelResponse:
        if self.cancelled.is_set():
            raise H2DS4Error(Code.POLICY_DENIED, 'cancelled: request not sent')
        body: dict[str, Any] = {'model': self.model_id, 'messages': messages,
                                'max_tokens': int(max_tokens), 'stream': stream}
        if tools:
            body['tools'] = tools
        if tool_choice:
            body['tool_choice'] = tool_choice
        if temperature is not None:
            body['temperature'] = temperature
        if stream:
            body['stream_options'] = {'include_usage': True}
            return self._chat_stream(body)
        try:
            r = self.http.post('/v1/chat/completions', json=body)
        except httpx.ReadTimeout as e:
            raise H2DS4Error(Code.DEADLINE_EXCEEDED, 'model read timeout') from e
        except httpx.TransportError as e:
            raise H2DS4Error(Code.UPSTREAM_UNAVAILABLE, type(e).__name__) from e
        _no_redirect(r)
        if r.status_code in (429, 503):
            raise H2DS4Error(Code.MODEL_BUSY, f'HTTP {r.status_code}')
        if r.status_code != 200:
            raise H2DS4Error(Code.PROTOCOL_ERROR, f'HTTP {r.status_code}')
        return normalize_completion(_json(r), raw=r.content, expected_model=self.model_id)

    def _chat_stream(self, body: dict) -> NormalizedModelResponse:
        raw = bytearray()
        try:
            with self.http.stream('POST', '/v1/chat/completions', json=body) as r:
                _no_redirect(r)
                if r.status_code in (429, 503):
                    raise H2DS4Error(Code.MODEL_BUSY, f'HTTP {r.status_code}')
                if r.status_code != 200:
                    raise H2DS4Error(Code.PROTOCOL_ERROR, f'HTTP {r.status_code}')
                chunks = []
                for chunk in iter_sse(r.iter_lines(), raw):
                    if self.cancelled.is_set():
                        raise H2DS4Error(Code.POLICY_DENIED, 'cancelled mid-stream')
                    chunks.append(chunk)
        except httpx.ReadTimeout as e:
            raise H2DS4Error(Code.DEADLINE_EXCEEDED, 'model read timeout') from e
        except httpx.TransportError as e:
            raise H2DS4Error(Code.PROTOCOL_ERROR, 'INCOMPLETE: stream closed early') from e
        return assemble_stream(chunks, raw=bytes(raw), expected_model=self.model_id)


def _no_redirect(r: httpx.Response) -> None:
    if 300 <= r.status_code < 400:
        raise H2DS4Error(Code.POLICY_DENIED, 'redirect from model endpoint refused')


def _json(r: httpx.Response) -> dict:
    try:
        data = r.json()
    except ValueError as e:
        raise H2DS4Error(Code.PROTOCOL_ERROR, 'invalid JSON from model endpoint') from e
    if not isinstance(data, dict):
        raise H2DS4Error(Code.PROTOCOL_ERROR, 'model response is not an object')
    return data


def _usage(u: object) -> Usage:
    if not isinstance(u, dict):
        return Usage(None, None, None, 'unknown')
    def num(key: str) -> int | None:
        v = u.get(key)
        return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None
    details = u.get('prompt_tokens_details')
    cached = details.get('cached_tokens') if isinstance(details, dict) else None
    pin, pout = num('prompt_tokens'), num('completion_tokens')
    if pin is None or pout is None:
        return Usage(pin, pout, None, 'unknown')
    return Usage(pin, pout, cached if isinstance(cached, int) else None, 'provider')


def _tool_calls(raw_calls: object) -> tuple[dict, ...]:
    if raw_calls is None:
        return ()
    if not isinstance(raw_calls, list):
        raise H2DS4Error(Code.PROTOCOL_ERROR, 'tool_calls must be a list')
    out: list[dict] = []
    seen: set[str] = set()
    for c in raw_calls:
        fn = c.get('function') if isinstance(c, dict) else None
        if not isinstance(fn, dict) or not isinstance(fn.get('name'), str):
            raise H2DS4Error(Code.PROTOCOL_ERROR, 'malformed tool call')
        cid = c.get('id')
        if not isinstance(cid, str) or not cid or cid in seen:
            raise H2DS4Error(Code.PROTOCOL_ERROR, 'missing or duplicate tool_call id')
        seen.add(cid)
        args = fn.get('arguments', '')
        try:
            parsed = json.loads(args) if isinstance(args, str) and args else {}
        except json.JSONDecodeError as e:
            raise H2DS4Error(Code.PROTOCOL_ERROR, 'tool call arguments are not valid JSON') from e
        if not isinstance(parsed, dict):
            raise H2DS4Error(Code.PROTOCOL_ERROR, 'tool call arguments must be an object')
        out.append({'id': cid, 'name': fn['name'], 'arguments': parsed})
    return tuple(out)


def normalize_completion(data: dict, *, raw: bytes, expected_model: str) -> NormalizedModelResponse:
    if 'error' in data:
        raise H2DS4Error(Code.PROTOCOL_ERROR, 'model returned an error object')
    choices = data.get('choices')
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise H2DS4Error(Code.PROTOCOL_ERROR, 'response has no choices')
    model = data.get('model')
    if expected_model and model != expected_model:
        raise H2DS4Error(Code.PROFILE_MISMATCH, 'response model differs from the profile')
    msg = choices[0].get('message')
    if not isinstance(msg, dict):
        raise H2DS4Error(Code.PROTOCOL_ERROR, 'choice has no message')
    content = msg.get('content') or ''
    if not isinstance(content, str):
        raise H2DS4Error(Code.PROTOCOL_ERROR, 'content must be a string')
    return NormalizedModelResponse(
        content=content, tool_calls=_tool_calls(msg.get('tool_calls')),
        finish_reason=choices[0].get('finish_reason'), usage=_usage(data.get('usage')),
        raw_digest=digest_bytes(raw), model=str(model))


def iter_sse(lines: Iterator[str], raw: bytearray) -> Iterator[dict]:
    done = False
    for line in lines:
        raw.extend(line.encode() + b'\n')
        if not line.startswith('data:'):
            continue
        payload = line[5:].strip()
        if payload == '[DONE]':
            done = True
            break
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError as e:
            raise H2DS4Error(Code.PROTOCOL_ERROR, 'malformed SSE chunk') from e
        if isinstance(obj, dict):
            yield obj
    if not done:
        raise H2DS4Error(Code.PROTOCOL_ERROR, 'INCOMPLETE: stream ended without [DONE]')


def assemble_stream(chunks: list[dict], *, raw: bytes,
                    expected_model: str) -> NormalizedModelResponse:
    content: list[str] = []
    calls: dict[int, dict] = {}
    finish = None
    usage: object = None
    model = None
    for ch in chunks:
        if 'error' in ch:
            raise H2DS4Error(Code.PROTOCOL_ERROR, 'model returned an error chunk')
        model = ch.get('model', model)
        if ch.get('usage'):
            usage = ch['usage']
        for choice in ch.get('choices') or []:
            delta = choice.get('delta') or {}
            if isinstance(delta.get('content'), str):
                content.append(delta['content'])
            for tc in delta.get('tool_calls') or []:
                idx = tc.get('index', 0)
                slot = calls.setdefault(idx, {'id': None, 'function': {'name': '', 'arguments': ''}})
                if tc.get('id'):
                    slot['id'] = tc['id']
                fn = tc.get('function') or {}
                if fn.get('name'):
                    slot['function']['name'] += fn['name']
                if fn.get('arguments'):
                    slot['function']['arguments'] += fn['arguments']
            if choice.get('finish_reason'):
                finish = choice['finish_reason']
    if expected_model and model != expected_model:
        raise H2DS4Error(Code.PROFILE_MISMATCH, 'stream model differs from the profile')
    ordered = [calls[i] for i in sorted(calls)]
    return NormalizedModelResponse(
        content=''.join(content), tool_calls=_tool_calls(ordered or None), finish_reason=finish,
        usage=_usage(usage), raw_digest=digest_bytes(raw), model=str(model))
