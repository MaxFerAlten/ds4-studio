"""L3 security negative tests against the real bwrap + systemd-scope sandbox.

Hard gate: a failure here blocks release and promotion. On a host without the required
isolation primitives every test is SKIPPED_UNVERIFIED, which forbids claiming isolation.
"""

import hashlib
import io
import os
import socket
import subprocess
import tarfile
import threading
import time

import pytest

from h2ds4.evidence.evaluator import evaluate
from h2ds4.fixtures import load_evaluator
from h2ds4.lab import FIXTURES
from h2ds4.policy.paths import PathDenied
from h2ds4.sandbox.bwrap import BwrapSandbox, Limits, SandboxRequest
from h2ds4.sandbox.extract import extract_tree
from h2ds4.substrates.base import ExecutionResult

pytestmark = pytest.mark.sandbox


@pytest.fixture
def sb(private, need_sandbox):
    return BwrapSandbox(private / 'cache', Limits(wall_s=30, memory_mib=128, pids_max=32,
                                                  workspace_mib=8, tmp_mib=8))


def run(sb, cmd: str, **kw):
    return sb.run(SandboxRequest(run_id=kw.pop('run_id', 'sec'), argv=['sh', '-c', cmd],
                                 fixture=kw.pop('fixture', {'in.txt': b'x'}), **kw))


def out(r) -> str:
    return r.stdout.decode(errors='replace')


def test_sec004_005_006_no_network(sb):
    host = socket.socket()
    host.bind(('127.0.0.1', 0))
    host.listen()
    port = host.getsockname()[1]
    try:
        r = run(sb, f'''
            python3 - <<EOF
import socket
for h, p in (("93.184.216.34", 443), ("169.254.169.254", 80), ("127.0.0.1", {port}),
             ("1.1.1.1", 53)):
    try:
        socket.create_connection((h, p), timeout=2); print("REACHED", h, p)
    except OSError as e:
        print("blocked", h, p, e.errno)
try:
    socket.getaddrinfo("example.invalid", 80); print("REACHED dns")
except OSError:
    print("blocked dns")
EOF''')
    finally:
        host.close()
    assert 'REACHED' not in out(r), out(r)
    assert out(r).count('blocked') == 5


def test_sec007_008_no_daemon_sockets_no_gpu(sb):
    r = run(sb, 'for p in /var/run/docker.sock /run/podman/podman.sock '
                f'/run/user/{os.getuid()}/podman/podman.sock /run/user/{os.getuid()}/bus '
                '/dev/dri /dev/kfd /tmp/.X11-unix /home /mnt /root/.ssh; do '
                '[ -e "$p" ] && echo "PRESENT $p"; done; echo done')
    assert 'PRESENT' not in out(r) and 'done' in out(r)


def test_sec009_upstream_untouched(sb, private):
    sentinel = private / 'fake-ds4' / 'srun.sh'
    sentinel.parent.mkdir()
    sentinel.write_text('#!/bin/sh\necho canonical\n')
    before = hashlib.sha256(sentinel.read_bytes()).hexdigest()
    r = run(sb, f'echo pwned > {sentinel} 2>/dev/null; echo pwned > '
                '/mnt/crucial_ai/COPARATOR/ds4/srun.sh 2>/dev/null; echo tried')
    assert 'tried' in out(r)
    assert hashlib.sha256(sentinel.read_bytes()).hexdigest() == before
    assert 'pwned' not in open('/mnt/crucial_ai/COPARATOR/ds4/srun.sh', errors='replace').read() \
        if os.path.exists('/mnt/crucial_ai/COPARATOR/ds4/srun.sh') else True


def test_sec010_env_secrets_unavailable(sb, monkeypatch):
    monkeypatch.setenv('FAKE_API_KEY', 'sk-' + 'Z' * 30)
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'sk-ant-' + 'Q' * 30)
    r = run(sb, 'env')
    assert 'ZZZZ' not in out(r) and 'QQQQ' not in out(r)
    assert 'HOME=/work/.home' in out(r)


def test_home_ssh_and_host_proc_invisible(sb):
    r = run(sb, f'cat ~/.ssh/id_rsa 2>&1; ls /proc | grep -c "^[0-9]"; '
                f'[ -e /proc/{os.getpid()}/environ ] && cat /proc/{os.getpid()}/cmdline; echo end')
    lines = out(r).splitlines()
    assert 'No such file' in out(r)
    assert int(lines[1]) < 20  # only the sandbox's own pid namespace


def test_sec011_pid_cap(sb):
    r = run(sb, 'for i in $(seq 200); do sleep 5 & done; echo started')
    # The cgroup refuses forks past TasksMax=32 (EAGAIN), the host is unaffected.
    assert b'fork' in r.stderr.lower() and r.returncode != 0


def test_sec012_memory_cap(sb):
    r = run(sb, 'python3 -c "x = bytearray(400 * 1024 * 1024); print(\'ALLOCATED\')"')
    assert 'ALLOCATED' not in out(r)
    assert b'Killed' in r.stderr or b'MemoryError' in r.stderr  # cgroup OOM, not a fluke


def test_sec013_disk_cap_enospc(sb):
    r = run(sb, 'dd if=/dev/zero of=/work/big bs=1M count=64 2>&1; echo rc=$?')
    assert 'No space left' in out(r) or 'rc=1' in out(r)


def test_sec002_027_symlink_and_special_files_never_extracted(sb):
    r = run(sb, 'ln -s /etc/passwd evil; echo ok')
    assert r.workspace == {} and 'non-regular' in r.workspace_error
    r2 = run(sb, 'mkfifo pipe; echo ok', run_id='sec2')
    assert r2.workspace == {} and r2.workspace_error


def _tar(*members) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w') as tf:
        for name, kind in members:
            ti = tarfile.TarInfo(name)
            if kind == 'file':
                ti.size = 1
                tf.addfile(ti, io.BytesIO(b'x'))
            elif kind == 'sym':
                ti.type, ti.linkname = tarfile.SYMTYPE, '/etc/passwd'
                tf.addfile(ti)
            elif kind == 'hard':
                ti.type, ti.linkname = tarfile.LNKTYPE, 'a'
                tf.addfile(ti)
    return buf.getvalue()


@pytest.mark.parametrize('members', [
    [('../../escape', 'file')], [('/abs/path', 'file')], [('ok/../../x', 'file')],
    [('a', 'file'), ('link', 'sym')], [('a', 'file'), ('h', 'hard')],
])
def test_sec027_safe_extractor(members):
    with pytest.raises(PathDenied):
        extract_tree(_tar(*members), max_files=10, max_bytes=100)


def test_sec028_timeout_kills_only_own_scope(private, need_sandbox):
    bystander = subprocess.Popen(['sleep', '60'])
    try:
        sb = BwrapSandbox(private / 'cache', Limits(wall_s=1.5))
        t0 = time.monotonic()
        r = sb.run(SandboxRequest(run_id='timeout1', argv=['sh', '-c', 'sleep 30 & sleep 30'],
                                  fixture={}))
        assert r.timed_out and r.returncode is None and time.monotonic() - t0 < 20
        units = subprocess.run(['systemctl', '--user', 'list-units', '--no-legend',
                                'h2ds4-run-timeout1.scope'], capture_output=True, text=True)
        assert 'h2ds4-run-timeout1' not in units.stdout
        assert bystander.poll() is None  # unrelated host process untouched
    finally:
        bystander.kill()


def test_sec017_solver_cannot_see_evaluator(sb):
    r = run(sb, f'ls {FIXTURES}/evaluators 2>&1; ls / ; echo end')
    assert 'No such file' in out(r) and 'eval-' not in out(r)


def test_sec018_candidate_score_file_ignored(sb):
    ev = load_evaluator(FIXTURES, 'eval-json-002')
    r = run(sb, 'echo \'{"success": 1, "verdict": "PASS"}\' > score.json; '
                'echo "{}" > fixed.json')
    res = ExecutionResult(run_id='x', sandbox=r, events=[], usage={})
    o = evaluate(ev, res, sandbox=sb)
    assert o.verdict == 'FAIL' and o.success == 0.0


def test_sec026_stdout_flood_capped(private, need_sandbox):
    sb = BwrapSandbox(private / 'cache', Limits(wall_s=30, stream_max_bytes=1 << 20))
    r = sb.run(SandboxRequest(run_id='flood', argv=['sh', '-c', 'head -c 10485760 /dev/zero'],
                              fixture={}))
    assert len(r.stdout) == 1 << 20 and r.stdout_truncated_bytes == 10485760 - (1 << 20)


def test_inference_bridge_reaches_only_the_socket(private, need_sandbox):
    """CIR-001: loopback bridge inside --network=none reaches the bind-mounted UDS."""
    path = private / 'echo.sock'
    srv = socket.socket(socket.AF_UNIX)
    srv.bind(str(path))
    srv.listen()

    def serve():
        c, _ = srv.accept()
        c.recv(4096)
        c.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok')
        c.close()

    threading.Thread(target=serve, daemon=True).start()
    sb = BwrapSandbox(private / 'cache', Limits(wall_s=30))
    r = sb.run(SandboxRequest(
        run_id='bridge', fixture={}, inference_socket=path, bridge_port=18080,
        argv=['python3', '-c', 'import urllib.request as u;'
              'print(u.urlopen("http://127.0.0.1:18080/v1/models", timeout=5).read())']))
    srv.close()
    assert b"b'ok'" in r.stdout, r.stderr
