"""L2 contracts against the fake OpenAI server: CT-001..012, SEC-023..025."""

import json
import socket
import threading

import httpx
import pytest
from dummy_openai_server import FakeServer, FakeState

from h2ds4.errors import Code, H2DS4Error
from h2ds4.model.capabilities import probe_static
from h2ds4.model.inference_gate import InferenceGate
from h2ds4.model.openai_client import OpenAIClient
from h2ds4.model.proxy import InferenceProxy, ProxyContext
from h2ds4.orchestration.budgets import Budget

MSG = [{'role': 'user', 'content': 'hi'}]


@pytest.fixture
def fake():
    with FakeServer(FakeState()) as s:
        yield s


def client(fake, model='ds4-test-model'):
    return OpenAIClient(fake.url, model, read_timeout_s=2)


def test_ct001_models_identifies_model(fake):
    c = client(fake)
    assert c.list_models() == ['ds4-test-model']
    c.require_model()


def test_ct002_model_mismatch_no_rollout(fake):
    with pytest.raises(H2DS4Error) as e:
        client(fake, 'expected-other').require_model()
    assert e.value.code == Code.PROFILE_MISMATCH
    fake.state.scenario = 'wrong_model'
    with pytest.raises(H2DS4Error) as e:
        client(fake).chat(MSG, max_tokens=8)
    assert e.value.code == Code.PROFILE_MISMATCH


def test_ct003_stream_usage_and_ct005_fragmented_tool_args(fake):
    r = client(fake).chat(MSG, max_tokens=8, stream=True)
    assert r.content == 'OK' and r.usage.source == 'provider'
    fake.state.scenario = 'stream_tools'
    t = client(fake).chat(MSG, max_tokens=8, stream=True)
    assert t.tool_calls == ({'id': 'call_9', 'name': 'echo', 'arguments': {'word': 'ok'}},)


def test_ct004_tool_call_normalised_and_ct011_not_executed(fake):
    fake.state.scenario = 'tool_call'
    r = client(fake).chat(MSG, max_tokens=8, tools=[{'type': 'function', 'function': {
        'name': 'echo', 'parameters': {'type': 'object'}}}])
    assert r.tool_calls[0] == {'id': 'call_1', 'name': 'echo', 'arguments': {'word': 'ok'}}
    assert len(fake.state.calls) == 1  # no follow-up execution by the client


@pytest.mark.parametrize('scenario', ['bad_tool_args', 'dup_tool_ids', 'no_choices',
                                      'error_200'])
def test_ct010_malformed_responses(fake, scenario):
    fake.state.scenario = scenario
    with pytest.raises(H2DS4Error) as e:
        client(fake).chat(MSG, max_tokens=8)
    assert e.value.code == Code.PROTOCOL_ERROR


def test_ct006_stream_eof_incomplete(fake):
    fake.state.scenario = 'stream_eof'
    with pytest.raises(H2DS4Error) as e:
        client(fake).chat(MSG, max_tokens=8, stream=True)
    assert 'INCOMPLETE' in e.value.detail


def test_ct007_no_request_after_cancel(fake):
    c = client(fake)
    c.cancelled.set()
    with pytest.raises(H2DS4Error):
        c.chat(MSG, max_tokens=8)
    assert fake.state.calls == []


def test_ct008_busy_not_retried_for_post(fake):
    fake.state.scenario = 'busy'
    with pytest.raises(H2DS4Error) as e:
        client(fake).chat(MSG, max_tokens=8)
    assert e.value.code == Code.MODEL_BUSY and len(fake.state.calls) == 1


def test_ct009_token_count_absent_and_usage_missing(fake):
    caps = probe_static(client(fake))['capabilities']
    assert caps['token_count'] == 'false' and caps['model_listed'] == 'true'
    fake.state.scenario = 'no_usage'
    assert client(fake).chat(MSG, max_tokens=8).usage.source == 'unknown'


def test_sec024_redirect_not_followed(fake):
    fake.state.scenario = 'redirect'
    with pytest.raises(H2DS4Error) as e:
        client(fake).chat(MSG, max_tokens=8)
    assert e.value.code == Code.POLICY_DENIED


def test_hang_is_deadline(fake):
    fake.state.scenario = 'hang'
    c = OpenAIClient(fake.url, 'ds4-test-model', read_timeout_s=0.5)
    with pytest.raises(H2DS4Error) as e:
        c.chat(MSG, max_tokens=8)
    assert e.value.code == Code.DEADLINE_EXCEEDED


def test_env_proxies_ignored(fake, monkeypatch):
    monkeypatch.setenv('HTTP_PROXY', 'http://127.0.0.1:1')
    monkeypatch.setenv('ALL_PROXY', 'http://127.0.0.1:1')
    assert client(fake).list_models() == ['ds4-test-model']


# -- proxy over UDS ---------------------------------------------------------------------

@pytest.fixture
def proxy(fake, private):
    up = httpx.Client(base_url=fake.url, trust_env=False, follow_redirects=False, timeout=5)
    ctx = ProxyContext(upstream=up, model_id='ds4-test-model', gate=InferenceGate(),
                       budget=Budget.from_limits(wall_s=60, model_calls=20, tool_calls=5,
                                                 input_tokens=100000, output_tokens=20000),
                       experiment_id='e', profile_digest='p', max_request_bytes=10000,
                       max_tokens_cap=256)
    p = InferenceProxy(private / 'inf.sock', ctx).start()
    yield p
    p.stop()


def uds(p) -> httpx.Client:
    return httpx.Client(transport=httpx.HTTPTransport(uds=str(p.path)), base_url='http://x',
                        timeout=10)


def test_proxy_socket_is_0600(proxy):
    import stat
    assert stat.S_IMODE(proxy.path.stat().st_mode) == 0o600


def test_sec023_route_and_method_whitelist(proxy):
    c = uds(proxy)
    assert c.get('/v1/models').json()['data'] == [{'id': 'ds4-test-model', 'object': 'model',
                                                   'owned_by': 'ds4'}]
    assert c.get('/latest/meta-data').status_code == 404
    assert c.post('/v1/embeddings', json={}).status_code == 404
    assert c.delete('/v1/models').status_code == 405
    assert c.request('CONNECT', '/v1/models').status_code in (404, 405, 501)


def test_proxy_forwards_and_accounts(proxy, fake):
    r = uds(proxy).post('/v1/chat/completions', json={'model': 'ds4-test-model',
                                                      'messages': MSG, 'max_tokens': 16})
    assert r.status_code == 200 and r.json()['choices'][0]['message']['content'] == 'OK'
    t = proxy.ctx.totals()
    assert t['model_calls'] == 1 and t['input_tokens'] == 11 and t['usage_source'] == 'provider'
    s = uds(proxy).post('/v1/chat/completions', json={'model': 'ds4-test-model', 'stream': True,
                                                      'messages': MSG, 'max_tokens': 16})
    assert 'data: [DONE]' in s.text and proxy.ctx.totals()['model_calls'] == 2


@pytest.mark.parametrize('body,code', [
    ({'model': 'other', 'messages': MSG}, 409),
    ({'model': 'ds4-test-model', 'messages': MSG, 'n': 2}, 422),
    ({'model': 'ds4-test-model', 'messages': MSG, 'max_tokens': 99999}, 429),
    ({'model': 'ds4-test-model', 'messages': MSG, 'evil_param': 1}, 400),
    ({'model': 'ds4-test-model', 'messages': []}, 400),
])
def test_proxy_rejects_bad_requests(proxy, fake, body, code):
    assert uds(proxy).post('/v1/chat/completions', json=body).status_code == code
    assert fake.state.calls == []


def test_proxy_oversize_and_content_type(proxy, fake):
    c = uds(proxy)
    big = {'model': 'ds4-test-model', 'messages': [{'role': 'user', 'content': 'x' * 20000}]}
    assert c.post('/v1/chat/completions', json=big).status_code == 413
    assert c.post('/v1/chat/completions', content=b'{}',
                  headers={'Content-Type': 'text/plain'}).status_code == 400
    assert fake.state.calls == []


def test_sec024_proxy_upstream_redirect(proxy, fake):
    fake.state.scenario = 'redirect'
    r = uds(proxy).post('/v1/chat/completions', json={'model': 'ds4-test-model',
                                                      'messages': MSG})
    assert r.status_code == 502


def test_sec025_model_switch_detected(proxy, fake):
    fake.state.scenario = 'swap_model'
    ok = {'model': 'ds4-test-model', 'messages': MSG}
    assert uds(proxy).post('/v1/chat/completions', json=ok).status_code == 200
    assert uds(proxy).post('/v1/chat/completions', json=ok).status_code == 409
    assert proxy.ctx.totals()['profile_mismatch'] is True


def test_ct012_proxy_serialises_concurrent_requests(proxy, fake):
    fake.state.delay_s = 0.05
    ok = {'model': 'ds4-test-model', 'messages': MSG, 'max_tokens': 8}
    codes = []

    def go():
        codes.append(uds(proxy).post('/v1/chat/completions', json=ok).status_code)

    ts = [threading.Thread(target=go) for _ in range(6)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert codes == [200] * 6 and fake.state.max_inflight == 1


def test_proxy_budget_exhaustion(fake, private):
    up = httpx.Client(base_url=fake.url, trust_env=False, follow_redirects=False)
    ctx = ProxyContext(upstream=up, model_id='ds4-test-model', gate=InferenceGate(),
                       budget=Budget.from_limits(wall_s=60, model_calls=1, tool_calls=0,
                                                 input_tokens=10000, output_tokens=10000),
                       experiment_id='e', profile_digest='p', max_tokens_cap=64)
    with InferenceProxy(private / 'b.sock', ctx) as p:
        ok = {'model': 'ds4-test-model', 'messages': MSG, 'max_tokens': 8}
        assert uds(p).post('/v1/chat/completions', json=ok).status_code == 200
        assert uds(p).post('/v1/chat/completions', json=ok).status_code == 429
    assert len(fake.state.calls) == 1


def test_proxy_refuses_existing_socket(private, fake):
    s = socket.socket(socket.AF_UNIX)
    s.bind(str(private / 'taken.sock'))
    up = httpx.Client(base_url=fake.url, trust_env=False)
    ctx = ProxyContext(upstream=up, model_id='m', gate=InferenceGate(),
                       budget=Budget.from_limits(wall_s=1, model_calls=1, tool_calls=1,
                                                 input_tokens=1, output_tokens=1),
                       experiment_id='e', profile_digest='p')
    with pytest.raises(H2DS4Error):
        InferenceProxy(private / 'taken.sock', ctx).start()
    assert json.dumps({}) == '{}'
