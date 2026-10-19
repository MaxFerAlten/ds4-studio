"""Capability probe (plan §9 item 2, §15.1). Every capability is true|false|unknown.

`probe_static` only lists models (cheap, no generation). `probe_live` sends tiny chat
requests and must only be called on an already-loaded model with explicit operator
authorisation; it is never a side effect of a health check.
"""

from __future__ import annotations

from typing import Literal

import httpx

from ..errors import Code, H2DS4Error
from .openai_client import OpenAIClient

Tri = Literal['true', 'false', 'unknown']

# Routes found statically in the DS4 checkout during WP00 (ds4_server.c request router).
STATIC_DS4_ROUTES = ('/v1/models', '/v1/chat/completions', '/v1/completions',
                     '/v1/messages', '/v1/responses')


def empty_matrix() -> dict[str, Tri]:
    return {k: 'unknown' for k in ('reachable', 'model_listed', 'chat', 'stream', 'tools',
                                   'tool_choice_none', 'usage', 'stream_usage',
                                   'token_count', 'cancel')}


def probe_static(client: OpenAIClient) -> dict:
    caps = empty_matrix()
    try:
        models = client.list_models()
    except H2DS4Error as e:
        caps['reachable'] = 'false'
        return {'capabilities': caps, 'models': [], 'error': str(e.code)}
    caps['reachable'] = 'true'
    caps['model_listed'] = 'true' if client.model_id in models else 'false'
    try:
        r = client.http.post('/v1/token-count', json={'model': client.model_id, 'input': 'x'})
        caps['token_count'] = 'true' if r.status_code == 200 else 'false'
    except httpx.TransportError:
        caps['token_count'] = 'unknown'
    return {'capabilities': caps, 'models': models}


def probe_live(client: OpenAIClient) -> dict:
    """Small generation probes. Caller holds the inference gate and a budget."""
    out = probe_static(client)
    caps = out['capabilities']
    if caps['model_listed'] != 'true':
        raise H2DS4Error(Code.PROFILE_MISMATCH, 'MODEL_ID_MISMATCH')
    msgs = [{'role': 'user', 'content': 'Rispondi esattamente OK.'}]
    r = client.chat(msgs, max_tokens=32)
    caps['chat'] = 'true'
    caps['usage'] = 'true' if r.usage.source == 'provider' else 'false'
    try:
        s = client.chat(msgs, max_tokens=32, stream=True)
        caps['stream'] = 'true'
        caps['stream_usage'] = 'true' if s.usage.source == 'provider' else 'false'
    except H2DS4Error:
        caps['stream'] = 'false'
    tool = {'type': 'function', 'function': {
        'name': 'echo', 'description': 'Echo a word back.',
        'parameters': {'type': 'object', 'properties': {'word': {'type': 'string'}},
                       'required': ['word']}}}
    try:
        t = client.chat([{'role': 'user', 'content': 'Call echo with word "ok".'}],
                        max_tokens=128, tools=[tool])
        # Raw DSML text instead of structured tool_calls means tools=false (plan §15.3).
        caps['tools'] = 'true' if t.tool_calls else 'false'
    except H2DS4Error:
        caps['tools'] = 'false'
    try:
        n = client.chat(msgs, max_tokens=32, tools=[tool], tool_choice='none')
        caps['tool_choice_none'] = 'true' if not n.tool_calls else 'false'
    except H2DS4Error:
        caps['tool_choice_none'] = 'false'
    caps['cancel'] = 'unknown'  # no verified cancel API on /v1/chat/completions
    return out
