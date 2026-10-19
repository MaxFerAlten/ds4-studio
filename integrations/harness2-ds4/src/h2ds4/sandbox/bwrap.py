"""Rootless execution sandbox: bubblewrap inside a transient systemd user scope (plan §26).

- namespaces: `--unshare-all` (user, pid, net, ipc, uts, cgroup); no network except the
  bind-mounted inference socket reached through the in-sandbox loopback bridge;
- filesystem: read-only /usr and explicitly listed toolchains, fixture read-only, the
  workspace is a size-capped tmpfs (ENOSPC, not a host disk), no home, no DS4 checkout,
  no GPU devices, no container/daemon sockets;
- limits: cgroup TasksMax/MemoryMax/CPUQuota from `systemd-run --user --scope`;
- output: the workspace comes back as a tar on a private pipe, extracted in memory by a
  safe extractor; the exit code comes back on a second pipe;
- cleanup: only the run-owned scope unit is stopped. Nothing else is ever signalled.

Every capability missing on the host means SANDBOX_UNAVAILABLE: fail closed.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from ..canonical import digest_obj
from ..errors import Code, H2DS4Error
from ..policy.paths import ensure_private_dir, write_tree_nofollow
from .extract import extract_tree

BRIDGE_PY = Path(__file__).with_name('bridge.py')
SANDBOX_SOCKET = '/run/h2ds4/inference.sock'
_UNIT_RE = re.compile(r'^[a-zA-Z0-9_.-]{1,80}$')


@dataclass(frozen=True)
class Limits:
    wall_s: float = 600.0
    memory_mib: int = 2048
    pids_max: int = 96
    cpu_quota_pct: int = 100
    workspace_mib: int = 256
    tmp_mib: int = 64
    output_max_bytes: int = 64 * 1024 * 1024
    output_max_files: int = 4096
    stream_max_bytes: int = 16 * 1024 * 1024


@dataclass
class SandboxRequest:
    run_id: str
    argv: list[str]
    fixture: dict[str, bytes]
    env: dict[str, str] = field(default_factory=dict)
    inference_socket: Path | None = None
    bridge_port: int = 18080
    ro_toolchains: tuple[str, ...] = ()
    extra_ro: dict[str, bytes] = field(default_factory=dict)  # dst path -> file content


@dataclass
class SandboxResult:
    returncode: int | None
    stdout: bytes
    stderr: bytes
    workspace: dict[str, bytes]
    timed_out: bool
    wall_ms: int
    stdout_truncated_bytes: int
    stderr_truncated_bytes: int
    isolation_profile_id: str
    workspace_error: str = ''


def isolation_profile(limits: Limits, ro_toolchains: tuple[str, ...]) -> str:
    return digest_obj({'backend': 'bwrap+systemd-scope', 'unshare': 'all', 'network': 'none',
                       'limits': asdict(limits), 'toolchains': sorted(ro_toolchains),
                       'v': 1})


def _which(name: str) -> str | None:
    return shutil.which(name, path='/usr/bin:/bin:/usr/local/bin')


def preflight(cache_dir: Path | None = None) -> dict:
    """Probe every isolation property the runner relies on; never raises."""
    checks: dict[str, bool | str] = {}
    bwrap, sdrun = _which('bwrap'), _which('systemd-run')
    checks['bwrap'] = bool(bwrap)
    checks['systemd_run'] = bool(sdrun)
    if not bwrap or not sdrun:
        return {'ok': False, 'checks': checks}
    base = _base_argv(Limits(), workspace=False)
    try:
        p = subprocess.run([bwrap, *base, 'python3', '-c',
                            'import socket,os\n'
                            's=socket.socket();s.bind(("127.0.0.1",0));s.listen()\n'
                            'c=socket.create_connection(s.getsockname())\n'
                            'print("lo-ok", os.path.exists("/dev/dri"), os.path.exists("/dev/kfd"))'],
                           capture_output=True, text=True, timeout=20)
        checks['userns_netns'] = p.returncode == 0
        checks['loopback'] = 'lo-ok' in p.stdout
        checks['gpu_devices_hidden'] = p.stdout.strip().endswith('False False')
    except (OSError, subprocess.SubprocessError) as e:
        checks['userns_netns'] = f'error: {type(e).__name__}'
    try:
        p = subprocess.run([sdrun, '--user', '--scope', '--quiet', '--collect',
                            '-p', 'TasksMax=8', '-p', 'MemoryMax=64M', 'true'],
                           capture_output=True, text=True, timeout=20)
        checks['cgroup_scope'] = p.returncode == 0
    except (OSError, subprocess.SubprocessError) as e:
        checks['cgroup_scope'] = f'error: {type(e).__name__}'
    ok = all(v is True for v in checks.values())
    return {'ok': ok, 'checks': checks}


def _base_argv(limits: Limits, *, workspace: bool = True) -> list[str]:
    argv = ['--unshare-all', '--die-with-parent', '--new-session', '--cap-drop', 'ALL',
            '--clearenv', '--hostname', 'h2ds4-sandbox',
            '--ro-bind', '/usr', '/usr',
            '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/sbin', '/sbin',
            '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
            '--proc', '/proc', '--dev', '/dev',
            '--size', str(limits.tmp_mib << 20), '--tmpfs', '/tmp',
            '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'LANG', 'C.UTF-8']
    for f in ('/etc/ld.so.cache', '/etc/ld.so.conf', '/etc/alternatives', '/etc/localtime'):
        if os.path.exists(f):
            argv += ['--ro-bind', f, f]
    if workspace:
        argv += ['--size', str(limits.workspace_mib << 20), '--tmpfs', '/work',
                 '--setenv', 'HOME', '/work/.home',
                 '--setenv', 'XDG_CONFIG_HOME', '/work/.home/.config',
                 '--setenv', 'XDG_DATA_HOME', '/work/.home/.local/share',
                 '--setenv', 'XDG_STATE_HOME', '/work/.home/.local/state',
                 '--setenv', 'XDG_CACHE_HOME', '/work/.home/.cache',
                 '--chdir', '/work']
    return argv


def _inner_script(tar_fd: int, rc_fd: int, bridge: bool) -> str:
    bridge_cmd = ''
    if bridge:
        bridge_cmd = (
            f'python3 /opt/h2ds4/bridge.py "$H2DS4_BRIDGE_PORT" {SANDBOX_SOCKET} '
            f'/work/.h2ds4/bridge.ready {tar_fd}>&- {rc_fd}>&- </dev/null >/dev/null 2>&1 &\n'
            'i=0; while [ ! -f /work/.h2ds4/bridge.ready ] && [ $i -lt 200 ]; do '
            'sleep 0.05; i=$((i+1)); done\n'
            '[ -f /work/.h2ds4/bridge.ready ] || { echo "bridge failed" >&2; exit 96; }\n')
    return (
        'set -u\n'
        'mkdir -p /work/.home /work/.h2ds4 || exit 97\n'
        'if [ -d /fixture ]; then cp -R /fixture/. /work/ || exit 97; fi\n'
        f'{bridge_cmd}'
        'cd /work\n'
        f'"$@" {tar_fd}>&- {rc_fd}>&-\n'
        'rc=$?\n'
        f'echo "$rc" >&{rc_fd}\n'
        f'exec {rc_fd}>&-\n'
        f'tar -C /work --exclude=./.h2ds4 -cf - . >&{tar_fd}\n'
    )


class _CappedReader(threading.Thread):
    def __init__(self, fd: int, cap: int):
        super().__init__(daemon=True)
        self.fd, self.cap = fd, cap
        self.buf = bytearray()
        self.dropped = 0

    def run(self) -> None:
        with os.fdopen(self.fd, 'rb', buffering=0) as f:
            while chunk := f.read(65536):
                room = self.cap - len(self.buf)
                if room > 0:
                    self.buf.extend(chunk[:room])
                self.dropped += max(0, len(chunk) - max(room, 0))


class BwrapSandbox:
    def __init__(self, cache_dir: Path, limits: Limits | None = None):
        self.cache_dir = cache_dir
        self.limits = limits or Limits()

    def run(self, req: SandboxRequest) -> SandboxResult:
        if not _UNIT_RE.fullmatch(req.run_id):
            raise H2DS4Error(Code.INVALID_INPUT, 'bad run id')
        bwrap, sdrun = _which('bwrap'), _which('systemd-run')
        if not bwrap or not sdrun:
            raise H2DS4Error(Code.SANDBOX_UNAVAILABLE, 'bwrap/systemd-run missing')
        lim = self.limits
        tmp_root = ensure_private_dir(self.cache_dir / 'tmp')
        stage = Path(tempfile.mkdtemp(prefix=f'{req.run_id}.', dir=tmp_root))
        os.chmod(stage, 0o700)
        fixture_dir = stage / 'fixture'
        fixture_dir.mkdir(mode=0o700)
        write_tree_nofollow(fixture_dir, req.fixture, mode=0o644)
        extra_dir = stage / 'extra'
        extra_dir.mkdir(mode=0o700)
        argv = [*_base_argv(lim), '--ro-bind', str(fixture_dir), '/fixture',
                '--ro-bind', str(BRIDGE_PY), '/opt/h2ds4/bridge.py']
        for i, (dst, data) in enumerate(sorted(req.extra_ro.items())):
            if not dst.startswith('/opt/') or '..' in dst.split('/'):
                raise H2DS4Error(Code.POLICY_DENIED, 'extra mounts only under /opt')
            src = extra_dir / f'f{i}'
            src.write_bytes(data)
            argv += ['--ro-bind', str(src), dst]
        for tc in req.ro_toolchains:
            if not os.path.isabs(tc) or not os.path.exists(tc):
                raise H2DS4Error(Code.SANDBOX_UNAVAILABLE, 'toolchain path missing')
            argv += ['--ro-bind', tc, tc]
        if req.inference_socket is not None:
            if not req.inference_socket.is_socket():
                raise H2DS4Error(Code.SANDBOX_UNAVAILABLE, 'inference socket missing')
            argv += ['--dir', '/run/h2ds4', '--bind', str(req.inference_socket), SANDBOX_SOCKET,
                     '--setenv', 'H2DS4_BRIDGE_PORT', str(req.bridge_port)]
        for k, v in sorted(req.env.items()):
            if not re.fullmatch(r'[A-Z][A-Z0-9_]{0,63}', k) or k in ('PATH', 'HOME'):
                raise H2DS4Error(Code.POLICY_DENIED, 'env name not allowed')
            argv += ['--setenv', k, v]
        tar_r, tar_w = os.pipe()
        rc_r, rc_w = os.pipe()
        script = _inner_script(tar_w, rc_w, req.inference_socket is not None)
        unit = f'h2ds4-run-{req.run_id}'
        cmd = [sdrun, '--user', '--scope', '--quiet', '--collect', '--unit', unit,
               '-p', f'TasksMax={lim.pids_max}', '-p', f'MemoryMax={lim.memory_mib}M',
               '-p', 'MemorySwapMax=0', '-p', f'CPUQuota={lim.cpu_quota_pct}%',
               '--', bwrap, *argv, 'bash', '-c', script, 'h2ds4-entry', *req.argv]
        t0 = time.monotonic()
        timed_out = False
        try:
            proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, pass_fds=(tar_w, rc_w),
                                    start_new_session=True)
        except OSError as e:
            for fd in (tar_r, tar_w, rc_r, rc_w):
                os.close(fd)
            shutil.rmtree(stage, ignore_errors=True)
            raise H2DS4Error(Code.SANDBOX_UNAVAILABLE, type(e).__name__) from e
        os.close(tar_w)
        os.close(rc_w)
        assert proc.stdout is not None and proc.stderr is not None
        readers = [_CappedReader(os.dup(proc.stdout.fileno()), lim.stream_max_bytes),
                   _CappedReader(os.dup(proc.stderr.fileno()), lim.stream_max_bytes),
                   _CappedReader(tar_r, lim.output_max_bytes + (1 << 20)),
                   _CappedReader(rc_r, 64)]
        proc.stdout.close()
        proc.stderr.close()
        for r in readers:
            r.start()
        try:
            proc.wait(timeout=lim.wall_s)
        except subprocess.TimeoutExpired:
            timed_out = True
            self._stop_unit(unit)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        for r in readers:
            r.join(timeout=10)
        wall_ms = int((time.monotonic() - t0) * 1000)
        self._stop_unit(unit)
        shutil.rmtree(stage, ignore_errors=True)
        out, err, tar_reader, rc_reader = readers
        rc_text = bytes(rc_reader.buf).decode(errors='replace').strip()
        rc = int(rc_text) if rc_text.isdigit() else None
        workspace: dict[str, bytes] = {}
        ws_err = ''
        if tar_reader.dropped:
            ws_err = 'workspace output over cap'
        elif tar_reader.buf:
            try:
                workspace = extract_tree(bytes(tar_reader.buf), max_files=lim.output_max_files,
                                         max_bytes=lim.output_max_bytes)
            except Exception as e:  # malformed/hostile archive: no output, recorded
                ws_err = f'workspace rejected: {e}'[:200]
        return SandboxResult(
            returncode=None if timed_out else rc, stdout=bytes(out.buf), stderr=bytes(err.buf),
            workspace=workspace, timed_out=timed_out, wall_ms=wall_ms,
            stdout_truncated_bytes=out.dropped, stderr_truncated_bytes=err.dropped,
            isolation_profile_id=isolation_profile(lim, req.ro_toolchains),
            workspace_error=ws_err)

    @staticmethod
    def _stop_unit(unit: str) -> None:
        # Only the run-owned scope: never pkill/killall (plan §34.3, SEC-028).
        systemctl = _which('systemctl')
        if systemctl:
            subprocess.run([systemctl, '--user', 'stop', f'{unit}.scope'],
                           capture_output=True, timeout=30)
