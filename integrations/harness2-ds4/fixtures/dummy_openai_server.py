"""Fake OpenAI-compatible server for contract tests (plan §35.3). Loopback only.

Behaviour is switched per test through `FakeState.scenario`:
ok | wrong_model | no_choices | error_200 | busy | redirect | hang | stream_ok |
stream_eof | stream_tools | tool_call | bad_tool_args | dup_tool_ids | no_usage | swap_model
"""

from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


@dataclass
class FakeState:
    model: str = 'ds4-test-model'
    scenario: str = 'ok'
    calls: list[dict] = field(default_factory=list)
    inflight: int = 0
    max_inflight: int = 0
    delay_s: float = 0.0
    lock: threading.Lock = field(default_factory=threading.Lock)


def _completion(model: str, content: str = 'OK', usage: bool = True,
                tool_calls: list | None = None) -> dict:
    msg: dict = {'role': 'assistant', 'content': content}
    if tool_calls is not None:
        msg['tool_calls'] = tool_calls
    out: dict = {'id': 'cmpl-1', 'object': 'chat.completion', 'model': model,
                 'choices': [{'index': 0, 'message': msg,
                              'finish_reason': 'tool_calls' if tool_calls else 'stop'}]}
    if usage:
        out['usage'] = {'prompt_tokens': 11, 'completion_tokens': 3, 'total_tokens': 14}
    return out


def make_handler(state: FakeState):
    class H(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *a):
            return

        def _json(self, status: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == '/v1/models':
                model = state.model
                if state.scenario == 'swap_model' and len(state.calls) >= 1:
                    model = 'other-model'
                return self._json(200, {'object': 'list', 'data': [{'id': model}]})
            if self.path == '/redirect-target':
                return self._json(200, {'leaked': True})
            self._json(404, {'error': 'nf'})

        def do_POST(self):
            n = int(self.headers.get('Content-Length', '0'))
            body = json.loads(self.rfile.read(n) or b'{}')
            if self.path == '/v1/token-count':
                return self._json(404, {'error': 'nf'})
            if self.path != '/v1/chat/completions':
                return self._json(404, {'error': 'nf'})
            with state.lock:
                state.calls.append(body)
                state.inflight += 1
                state.max_inflight = max(state.max_inflight, state.inflight)
            try:
                if state.delay_s:
                    time.sleep(state.delay_s)
                self._chat(body)
            finally:
                with state.lock:
                    state.inflight -= 1

        def _chat(self, body: dict) -> None:
            sc = state.scenario
            model = state.model
            if sc == 'busy':
                return self._json(503, {'error': {'message': 'busy'}})
            if sc == 'redirect':
                self.send_response(302)
                self.send_header('Location', 'http://169.254.169.254/latest')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            if sc == 'hang':
                time.sleep(5)
                return self._json(200, _completion(model))
            if sc == 'wrong_model':
                return self._json(200, _completion('other-model'))
            if sc == 'no_choices':
                return self._json(200, {'model': model, 'choices': []})
            if sc == 'error_200':
                return self._json(200, {'error': {'message': 'boom'}})
            if sc == 'no_usage':
                return self._json(200, _completion(model, usage=False))
            if sc == 'tool_call':
                return self._json(200, _completion(model, '', tool_calls=[
                    {'id': 'call_1', 'type': 'function',
                     'function': {'name': 'echo', 'arguments': '{"word": "ok"}'}}]))
            if sc == 'bad_tool_args':
                return self._json(200, _completion(model, '', tool_calls=[
                    {'id': 'call_1', 'type': 'function',
                     'function': {'name': 'echo', 'arguments': '{not json'}}]))
            if sc == 'dup_tool_ids':
                tc = {'id': 'call_1', 'type': 'function',
                      'function': {'name': 'echo', 'arguments': '{}'}}
                return self._json(200, _completion(model, '', tool_calls=[tc, dict(tc)]))
            if body.get('stream') or sc.startswith('stream'):
                return self._stream(body, model, sc)
            return self._json(200, _completion(model))

        def _stream(self, body: dict, model: str, sc: str) -> None:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Connection', 'close')
            self.end_headers()
            chunks = []
            if sc == 'stream_tools':
                chunks += [
                    {'model': model, 'choices': [{'index': 0, 'delta': {'tool_calls': [
                        {'index': 0, 'id': 'call_9', 'function': {'name': 'ec', 'arguments': '{"wo'}}]}}]},
                    {'model': model, 'choices': [{'index': 0, 'delta': {'tool_calls': [
                        {'index': 0, 'function': {'name': 'ho', 'arguments': 'rd": "ok"}'}}]}}]},
                ]
            else:
                chunks += [{'model': model, 'choices': [{'index': 0, 'delta': {'content': 'O'}}]},
                           {'model': model, 'choices': [{'index': 0, 'delta': {'content': 'K'}}]}]
            chunks.append({'model': model, 'choices': [{'index': 0, 'delta': {},
                                                        'finish_reason': 'stop'}]})
            if sc != 'stream_eof':
                chunks.append({'model': model, 'choices': [],
                               'usage': {'prompt_tokens': 5, 'completion_tokens': 2}})
            for c in chunks:
                self.wfile.write(f'data: {json.dumps(c)}\n\n'.encode())
                self.wfile.flush()
            if sc != 'stream_eof':
                self.wfile.write(b'data: [DONE]\n\n')
            self.close_connection = True

    return H


class FakeServer:
    def __init__(self, state: FakeState | None = None):
        self.state = state or FakeState()
        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(self.state))
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self.url = f'http://127.0.0.1:{self.port}'
        self._t = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self) -> FakeServer:
        self._t.start()
        return self

    def __exit__(self, *a) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
