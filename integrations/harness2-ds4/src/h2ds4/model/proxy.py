"""Host-side inference proxy on a Unix socket (plan §16.3, §26.3, §33.4).

The sandbox reaches the model only through this socket. Route whitelist:

    GET  /v1/models            -> the pinned model id only
    POST /v1/chat/completions  -> validated, budgeted, serialised, forwarded
    POST /v1/token-count       -> only when the capability was verified
    anything else              -> 404 NOT_SUPPORTED / 405 METHOD_NOT_ALLOWED

It is not a forward proxy: the upstream is fixed at construction to the validated local
DS4 URL, redirects are refused, and environment proxies are ignored.
"""

from __future__ import annotations

import json
import os
import socket
import socketserver
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler
from pathlib import Path

import httpx

from ..errors import Code, H2DS4Error
from ..orchestration.budgets import Budget, estimate_tokens
from .inference_gate import InferenceGate

ALLOWED_KEYS = frozenset({
    'model', 'messages', 'max_tokens', 'max_completion_tokens', 'stream', 'stream_options',
    'tools', 'tool_choice', 'temperature', 'top_p', 'top_k', 'stop', 'seed',
    'response_format', 'parallel_tool_calls', 'frequency_penalty', 'presence_penalty', 'n',
})


def normalize_compatible_request(body: dict) -> dict:
    """Drop the OpenAI storage hint; this local backend has no response-store API."""
    normalized = dict(body)
    if 'store' in normalized:
        if type(normalized['store']) is not bool:
            raise H2DS4Error(Code.INVALID_INPUT, 'store must be a boolean')
        normalized.pop('store')
    return normalized


@dataclass
class CallRecord:
    started: float
    queue_ms: int
    duration_ms: int
    status: int
    input_tokens: int | None
    output_tokens: int | None
    usage_source: str
    stream: bool


@dataclass
class ProxyContext:
    upstream: httpx.Client
    model_id: str
    gate: InferenceGate
    budget: Budget
    experiment_id: str
    profile_digest: str
    max_request_bytes: int = 4 * 1024 * 1024
    max_tokens_cap: int = 4096
    token_count_verified: bool = False
    socket_path: Path | None = None
    calls: list[CallRecord] = field(default_factory=list)
    denied: list[str] = field(default_factory=list)
    profile_mismatch: bool = False
    lock: threading.Lock = field(default_factory=threading.Lock)

    def totals(self) -> dict:
        with self.lock:
            known = [c for c in self.calls if c.usage_source == 'provider']
            return {
                'model_calls': len(self.calls),
                'input_tokens': sum(c.input_tokens or 0 for c in known),
                'output_tokens': sum(c.output_tokens or 0 for c in known),
                'usage_source': ('none' if not self.calls else
                                 'provider' if len(known) == len(self.calls) else 'unknown'),
                'queue_ms': sum(c.queue_ms for c in self.calls),
                'inference_ms': sum(c.duration_ms for c in self.calls),
                'denied': list(self.denied),
                'profile_mismatch': self.profile_mismatch,
            }


class _Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server: _Server

    def log_message(self, *_args: object) -> None:  # no raw request logging
        return

    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        # One request per connection: a denial may leave an unread body on the socket, and
        # reusing it would desynchronise request framing (smuggling-style).
        self.send_header('Connection', 'close')
        self.close_connection = True
        self.end_headers()
        self.wfile.write(data)

    def _deny(self, code: Code, detail: str, status: int | None = None) -> None:
        ctx = self.server.ctx
        with ctx.lock:
            ctx.denied.append(f'{code}:{detail}'[:120])
        self._send(status or H2DS4Error(code).http_status, {'error': {'code': str(code),
                                                                      'message': detail}})

    def do_GET(self) -> None:
        if self.path.split('?', 1)[0] == '/v1/models':
            self._send(200, {'object': 'list', 'data': [
                {'id': self.server.ctx.model_id, 'object': 'model', 'owned_by': 'ds4'}]})
        else:
            self._deny(Code.NOT_SUPPORTED, 'route not whitelisted')

    def do_POST(self) -> None:
        path = self.path.split('?', 1)[0]
        if path == '/v1/chat/completions':
            self._chat()
        elif path == '/v1/token-count' and self.server.ctx.token_count_verified:
            self._deny(Code.NOT_SUPPORTED, 'token-count passthrough not implemented')
        else:
            self._deny(Code.NOT_SUPPORTED, 'route not whitelisted')

    def _method_not_allowed(self) -> None:
        self._deny(Code.METHOD_NOT_ALLOWED, 'method not allowed')

    do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = _method_not_allowed  # noqa: N815

    def _read_body(self) -> dict | None:
        ctx = self.server.ctx
        if self.headers.get('Transfer-Encoding'):
            self._deny(Code.INVALID_INPUT, 'chunked bodies not accepted')
            return None
        try:
            length = int(self.headers.get('Content-Length', ''))
        except ValueError:
            self._deny(Code.INVALID_INPUT, 'Content-Length required')
            return None
        if length < 0 or length > ctx.max_request_bytes:
            self._deny(Code.TOO_LARGE, 'request too large')
            return None
        ctype = (self.headers.get('Content-Type') or '').split(';')[0].strip().lower()
        if ctype != 'application/json':
            self._deny(Code.INVALID_INPUT, 'content-type must be application/json')
            return None
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._deny(Code.INVALID_INPUT, 'invalid JSON')
            return None
        if not isinstance(body, dict):
            self._deny(Code.INVALID_INPUT, 'body must be an object')
            return None
        return body

    def _chat(self) -> None:
        ctx = self.server.ctx
        body = self._read_body()
        if body is None:
            return
        try:
            body = normalize_compatible_request(body)
        except H2DS4Error as e:
            return self._deny(e.code, e.detail)
        extra = sorted(set(body) - ALLOWED_KEYS)
        if extra:
            return self._deny(Code.INVALID_INPUT, f'unsupported parameters: {extra[:5]}')
        if body.get('model') != ctx.model_id:
            return self._deny(Code.PROFILE_MISMATCH, 'model differs from the pinned profile')
        if body.get('n', 1) != 1:
            return self._deny(Code.POLICY_DENIED, 'n>1 not authorised')
        if not isinstance(body.get('messages'), list) or not body['messages']:
            return self._deny(Code.INVALID_INPUT, 'messages required')
        mt = body.pop('max_completion_tokens', None)
        max_tokens = body.get('max_tokens', mt if mt is not None else ctx.max_tokens_cap)
        if isinstance(max_tokens, bool) or not isinstance(max_tokens, int) \
                or not 0 < max_tokens <= ctx.max_tokens_cap:
            return self._deny(Code.BUDGET_EXCEEDED, 'max_tokens outside the budget cap')
        body['max_tokens'] = max_tokens
        stream = bool(body.get('stream', False))
        try:
            ctx.budget.before_model(estimate_tokens(json.dumps(body['messages'])), max_tokens)
        except H2DS4Error as e:
            return self._deny(e.code, e.detail)
        t_queue = time.monotonic()
        try:
            permit = ctx.gate.acquire(ctx.experiment_id, ctx.profile_digest, timeout_s=600)
        except H2DS4Error as e:
            return self._deny(e.code, e.detail)
        queue_ms = int((time.monotonic() - t_queue) * 1000)
        uncertain = False
        t0 = time.monotonic()
        status, usage = 502, None
        try:
            # Backend switch check before every request (plan §18.1).
            try:
                r = ctx.upstream.get('/v1/models')
                listed = [m.get('id') for m in r.json().get('data', [])] \
                    if r.status_code == 200 else []
            except (httpx.TransportError, ValueError):
                listed = []
            if ctx.model_id not in listed:
                with ctx.lock:
                    ctx.profile_mismatch = True
                return self._deny(Code.PROFILE_MISMATCH, 'upstream model changed or unavailable')
            if stream:
                status, usage = self._relay_stream(body)
            else:
                status, usage = self._relay(body)
        except httpx.ReadTimeout:
            uncertain = True
            self._deny(Code.DEADLINE_EXCEEDED, 'upstream timeout; backend state uncertain')
        except httpx.TransportError:
            self._deny(Code.UPSTREAM_UNAVAILABLE, 'upstream unavailable')
        finally:
            ctx.gate.release(permit, uncertain=uncertain)
            u = usage if isinstance(usage, dict) else {}
            pin, pout = u.get('prompt_tokens'), u.get('completion_tokens')
            known = isinstance(pin, int) and isinstance(pout, int)
            with ctx.lock:
                ctx.calls.append(CallRecord(t0, queue_ms, int((time.monotonic() - t0) * 1000),
                                            status, pin if known else None,
                                            pout if known else None,
                                            'provider' if known else 'unknown', stream))

    def _relay(self, body: dict) -> tuple[int, object]:
        r = self.server.ctx.upstream.post('/v1/chat/completions', json=body)
        if 300 <= r.status_code < 400:
            self._deny(Code.POLICY_DENIED, 'redirect from model endpoint refused', 502)
            return 502, None
        try:
            data = r.json()
        except ValueError:
            self._deny(Code.PROTOCOL_ERROR, 'upstream returned invalid JSON')
            return 502, None
        self._send(r.status_code, data)
        return r.status_code, data.get('usage') if isinstance(data, dict) else None

    def _relay_stream(self, body: dict) -> tuple[int, object]:
        body.setdefault('stream_options', {'include_usage': True})
        usage = None
        with self.server.ctx.upstream.stream('POST', '/v1/chat/completions', json=body) as r:
            if 300 <= r.status_code < 400:
                self._deny(Code.POLICY_DENIED, 'redirect from model endpoint refused', 502)
                return 502, None
            if r.status_code != 200:
                data = r.read()
                self.send_response(r.status_code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Connection', 'close')
                self.close_connection = True
                self.end_headers()
                self.wfile.write(data)
                return r.status_code, None
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'close')
            self.end_headers()
            self.close_connection = True
            for line in r.iter_lines():
                if line.startswith('data:') and '"usage"' in line:
                    try:
                        obj = json.loads(line[5:].strip())
                        usage = obj.get('usage') or usage
                    except json.JSONDecodeError:
                        pass
                self.wfile.write(line.encode() + b'\n')
                self.wfile.flush()
        return 200, usage


class _Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    ctx: ProxyContext


class InferenceProxy:
    def __init__(self, socket_path: Path, ctx: ProxyContext):
        self.path = socket_path
        self.ctx = ctx
        ctx.socket_path = socket_path
        self._server: _Server | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> InferenceProxy:
        if self.path.exists() or self.path.is_symlink():
            raise H2DS4Error(Code.CONFLICT, 'inference socket exists; recover explicitly')
        old = os.umask(0o077)
        try:
            srv = _Server(str(self.path), _Handler, bind_and_activate=False)
            srv.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            srv.server_bind()
            os.chmod(self.path, 0o600)
            srv.server_activate()
        finally:
            os.umask(old)
        srv.ctx = self.ctx
        self._server = srv
        self._thread = threading.Thread(target=srv.serve_forever, name='h2ds4-proxy',
                                        daemon=True)
        self._thread.start()
        return self

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None
        try:
            if self.path.is_socket():
                self.path.unlink()
        except FileNotFoundError:
            pass

    def __enter__(self) -> InferenceProxy:
        return self.start()

    def __exit__(self, *_exc: object) -> None:
        self.stop()
