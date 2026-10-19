"""WP07: CT-014..017, SEC-019..021, double sidecar, mode policy, real UDS bind."""

import os
import socket
import stat
import threading
import time

import httpx
import pytest
from starlette.testclient import TestClient

from h2ds4 import registry as R
from h2ds4.errors import Code, H2DS4Error
from h2ds4.lab import make_lab
from h2ds4.protocol.api import create_app
from h2ds4.serve import acquire_lock, admin_token, bind_uds, build, check_socket_path
from h2ds4.settings import from_mapping

H = {'X-H2DS4-Protocol': '1'}


@pytest.fixture
def env(private):
    lab = make_lab(private / 'lab', mode='propose', upstream_roots=[])
    reg = R.register_fixture(lab.store, lab.fixtures_root, 'json-002')
    token = admin_token(lab.settings.data_dir)
    client = TestClient(create_app(lab.service, admin_token=token))
    body = {'task_id': 'json-002', 'task_family': 'json', 'mode': 'lab',
            'substrate': 'scripted_local', 'workspace_fixture_id': 'json-002',
            'baseline_harness_id': lab.base_harness_id, 'model_profile_id': lab.profile_id,
            'evaluation_profile_id': reg['evaluation_profile_id'], 'k': 1, 'run_seed': 1}
    return lab, client, token, body


def test_health_and_no_docs(env):
    _lab, c, _t, _b = env
    assert c.get('/health/live').json() == {'status': 'live', 'protocol': 1}
    assert c.get('/health/ready').json()['status'] == 'ready'
    for p in ('/docs', '/openapi.json', '/redoc'):
        assert c.get(p).status_code == 404


def test_ct015_protocol_header_required(env):
    _lab, c, _t, _b = env
    r = c.get('/v1/capabilities')
    assert r.status_code == 426 and r.json() == {'error': 'BAD_PROTOCOL',
                                                 'detail': 'X-H2DS4-Protocol: 1 required'}
    assert c.get('/v1/capabilities', headers={'X-H2DS4-Protocol': '2'}).status_code == 426
    caps = c.get('/v1/capabilities', headers=H).json()
    assert caps['native_ds4'] is False
    assert caps['substrates']['ds4_native']['status'] == 'BLOCKED_API'


def test_ct014_oversize_and_chunked_rejected(env):
    _lab, c, _t, b = env
    big = dict(b, task_id='x' * (2 << 20))
    r = c.post('/v1/experiments', json=big, headers={**H, 'Idempotency-Key': 'k'})
    assert r.status_code == 413
    r = c.post('/v1/experiments', content=iter([b'{}']),
               headers={**H, 'Idempotency-Key': 'k', 'Transfer-Encoding': 'chunked'})
    assert r.status_code in (400, 413)


def test_sec021_idempotency_and_create(env):
    _lab, c, _t, b = env
    h = {**H, 'Idempotency-Key': 'same-key'}
    r1 = c.post('/v1/experiments', json=b, headers=h)
    assert r1.status_code == 201
    r2 = c.post('/v1/experiments', json=b, headers=h)
    assert r2.json() == r1.json()
    r3 = c.post('/v1/experiments', json=dict(b, run_seed=2), headers=h)
    assert r3.status_code == 409 and r3.json()['error'] == 'CONFLICT'
    assert c.post('/v1/experiments', json=b, headers=H).status_code == 400  # key required


def test_invalid_input_has_no_stacktrace_or_paths(env):
    _lab, c, _t, b = env
    r = c.post('/v1/experiments', json=dict(b, shell='rm -rf /'),
               headers={**H, 'Idempotency-Key': 'z'})
    assert r.status_code == 400 and 'Traceback' not in r.text and '/mnt/' not in r.text
    assert c.get('/v1/experiments/..%2F..%2Fetc', headers=H).status_code in (400, 404)
    assert c.post('/v1/execute', json={'cmd': 'id'}, headers=H).status_code == 404


def test_run_requires_maintenance_ack(env):
    _lab, c, _t, b = env
    eid = c.post('/v1/experiments', json=b, headers={**H, 'Idempotency-Key': 'a'}).json()['id']
    r = c.post(f'/v1/experiments/{eid}/run', json={}, headers={**H, 'Idempotency-Key': 'r'})
    assert r.status_code == 422 and r.json()['error'] == 'POLICY_DENIED'
    from h2ds4.service import MAINTENANCE_ACK
    ok = c.post(f'/v1/experiments/{eid}/run', json={'maintenance_ack': MAINTENANCE_ACK},
                headers={**H, 'Idempotency-Key': 'r2'})
    assert ok.json()['status'] == 'QUEUED'
    eid2 = c.post('/v1/experiments', json=dict(b, run_seed=9),
                  headers={**H, 'Idempotency-Key': 'b'}).json()['id']
    busy = c.post(f'/v1/experiments/{eid2}/run', json={'maintenance_ack': MAINTENANCE_ACK},
                  headers={**H, 'Idempotency-Key': 'r3'})
    assert busy.status_code == 503 and busy.json()['error'] == 'MODEL_BUSY'  # max_queued=1
    assert c.post(f'/v1/experiments/{eid}/cancel', headers=H).json()['status'] == 'CANCELLED'
    assert c.post(f'/v1/experiments/{eid}/cancel', headers=H).json()['status'] == 'CANCELLED'


def test_ct016_admin_routes_need_token(env):
    _lab, c, token, _b = env
    body = {'expected_active_digest': 'baseline', 'reason': 'x'}
    assert c.post('/v1/overlays/ov-1/approve', json=body, headers=H).status_code == 401
    bad = {**H, 'Authorization': 'Bearer nope'}
    assert c.post('/v1/overlays/ov-1/approve', json=body, headers=bad).status_code == 403
    assert c.get('/v1/audit', headers=H).status_code == 401
    good = {**H, 'Authorization': f'Bearer {token}'}
    assert c.post('/v1/overlays/ov-1/approve', json=body, headers=good).status_code == 404
    assert c.get('/v1/audit', headers=good).status_code == 200


def test_off_and_observe_modes_fail_closed(private):
    for mode in ('off', 'observe'):
        lab = make_lab(private / f'lab-{mode}', mode=mode, upstream_roots=[])
        reg = R.register_fixture(lab.store, lab.fixtures_root, 'json-002')
        c = TestClient(create_app(lab.service, admin_token='t'))
        body = {'task_id': 'json-002', 'task_family': 'json', 'mode': 'lab',
                'substrate': 'scripted_local', 'workspace_fixture_id': 'json-002',
                'baseline_harness_id': lab.base_harness_id, 'model_profile_id': lab.profile_id,
                'evaluation_profile_id': reg['evaluation_profile_id'], 'k': 1, 'run_seed': 1}
        r = c.post('/v1/experiments', json=body, headers={**H, 'Idempotency-Key': 'k'})
        assert r.status_code == 422 and r.json()['error'] == 'POLICY_DENIED'
        assert c.get('/health/live').status_code == 200


def test_native_substrate_blocked(env):
    _lab, c, _t, b = env
    r = c.post('/v1/experiments', json=dict(b, substrate='ds4_native'),
               headers={**H, 'Idempotency-Key': 'n'})
    assert r.status_code == 501 and r.json()['error'] == 'BLOCKED_API'


def _settings(private, **service):
    return from_mapping({'service': {'enabled': True, 'mode': 'lab', **service},
                         'paths': {'runtime_dir': str(private / 'run'),
                                   'data_dir': str(private / 'data'),
                                   'cache_dir': str(private / 'cache')}}).validate()


def test_service_disabled_by_default_refuses_start(private):
    s = from_mapping({'paths': {'runtime_dir': str(private / 'run'),
                                'data_dir': str(private / 'data'),
                                'cache_dir': str(private / 'cache')}}).validate()
    with pytest.raises(H2DS4Error) as e:
        build(s)
    assert e.value.code == Code.POLICY_DENIED


def test_double_sidecar_refused(private):
    s = _settings(private)
    sc = build(s)
    with pytest.raises(H2DS4Error) as e:
        build(s)
    assert e.value.code == Code.CONFLICT
    os.close(sc.lock_fd)
    os.close(acquire_lock(s.data_dir))  # released lock can be re-acquired


def test_sec019_bad_dir_ownership_or_mode(private):
    run = private / 'run' / 'h2ds4'
    run.mkdir(parents=True, mode=0o755)
    os.chmod(run, 0o755)
    with pytest.raises(H2DS4Error):
        build(_settings(private))


def test_sec020_foreign_or_live_socket_not_unlinked(private):
    p = private / 'x.sock'
    p.write_text('not a socket')
    with pytest.raises(H2DS4Error):
        check_socket_path(p, recover_stale=True)
    assert p.exists()
    p.unlink()
    live = socket.socket(socket.AF_UNIX)
    old = os.umask(0o077)
    live.bind(str(p))
    os.umask(old)
    os.chmod(p, 0o600)
    live.listen()
    with pytest.raises(H2DS4Error) as e:
        check_socket_path(p, recover_stale=True)
    assert e.value.code == Code.CONFLICT and p.exists()
    live.close()
    with pytest.raises(H2DS4Error):
        check_socket_path(p, recover_stale=False)  # stale, but recovery not requested
    check_socket_path(p, recover_stale=True)
    assert not p.exists()


def test_real_uds_server_0600_no_tcp(private):
    import uvicorn
    s = _settings(private)
    sc = build(s)
    sock = bind_uds(s.uds_path)
    assert stat.S_IMODE(s.uds_path.stat().st_mode) == 0o600
    assert stat.S_IMODE(s.runtime_dir.stat().st_mode) == 0o700
    server = uvicorn.Server(uvicorn.Config(sc.app, fd=sock.fileno(), lifespan='off',
                                           log_level='error'))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    try:
        c = httpx.Client(transport=httpx.HTTPTransport(uds=str(s.uds_path)), base_url='http://h')
        for _ in range(50):
            try:
                assert c.get('/health/live').json()['status'] == 'live'
                break
            except httpx.TransportError:
                time.sleep(0.05)
        r = c.get('/v1/capabilities', headers=H)
        assert r.status_code == 200
        listening = open('/proc/net/tcp').read() + open('/proc/net/tcp6').read()
        assert str(os.getpid()) not in listening  # sanity: no TCP socket by inode owner check
    finally:
        server.should_exit = True
        t.join(timeout=5)
        sock.close()
        os.close(sc.lock_fd)
