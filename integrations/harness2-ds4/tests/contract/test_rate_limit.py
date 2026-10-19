from types import SimpleNamespace

from starlette.testclient import TestClient

from h2ds4.protocol.api import create_app


def test_v1_requests_are_rate_limited_but_health_remains_available():
    app = create_app(SimpleNamespace(capabilities=lambda: {'mode': 'lab'}),
                     admin_token='test-token', requests_per_minute=1)
    with TestClient(app) as client:
        headers = {'X-H2DS4-Protocol': '1'}
        assert client.get('/v1/capabilities', headers=headers).status_code == 200
        limited = client.get('/v1/capabilities', headers=headers)
        assert limited.status_code == 429
        assert limited.json()['error'] == 'RATE_LIMITED'
        assert client.get('/health/live').status_code == 200
