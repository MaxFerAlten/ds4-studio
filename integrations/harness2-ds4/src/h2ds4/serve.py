"""Sidecar bootstrap on a Unix socket (plan §30.5, §34.1, WP07).

Order matters: validated config -> private dirs (0700, owned) -> exclusive data-dir lock
(a second sidecar fails with CONFLICT) -> socket path checks (never unlink a socket that
is foreign, alive, or not proven stale) -> umask 077 bind + chmod 0600 -> one uvicorn
worker. No TCP listener is ever opened.
"""

from __future__ import annotations

import errno
import fcntl
import os
import secrets
import socket
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .errors import Code, H2DS4Error
from .orchestration.engine import Engine
from .orchestration.scheduler import Worker
from .policy.paths import ensure_private_dir
from .protocol.api import create_app
from .service import Service
from .settings import Mode, Settings
from .store.blobs import BlobStore
from .store.sqlite import SqliteStore

FIXTURES_ROOT = Path(__file__).resolve().parents[2] / 'fixtures'


def prepare_dirs(s: Settings) -> None:
    for d in (s.runtime_dir, s.data_dir, s.cache_dir):
        try:
            ensure_private_dir(d)
        except ValueError as e:
            raise H2DS4Error(Code.POLICY_DENIED, f'unsafe directory: {e}') from e


def acquire_lock(data_dir: Path) -> int:
    path = data_dir / 'h2ds4.lock'
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid():
        os.close(fd)
        raise H2DS4Error(Code.POLICY_DENIED, 'lock file ownership/type invalid')
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError as e:
        os.close(fd)
        raise H2DS4Error(Code.CONFLICT, 'another h2ds4 sidecar holds the data directory') from e
    os.ftruncate(fd, 0)
    os.write(fd, f'{os.getpid()}\n'.encode())
    return fd


def check_socket_path(sock: Path, *, recover_stale: bool) -> None:
    try:
        st = sock.lstat()
    except FileNotFoundError:
        return
    if not stat.S_ISSOCK(st.st_mode) or st.st_uid != os.getuid():
        raise H2DS4Error(Code.POLICY_DENIED, 'unsafe socket path (foreign or not a socket)')
    if stat.S_IMODE(st.st_mode) != 0o600:
        raise H2DS4Error(Code.POLICY_DENIED, 'unsafe socket permissions')
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        probe.connect(str(sock))
        raise H2DS4Error(Code.CONFLICT, 'a live service already answers on the socket')
    except OSError as e:
        if e.errno not in (errno.ECONNREFUSED, errno.ENOENT):
            raise H2DS4Error(Code.CONFLICT, 'socket state uncertain') from e
    finally:
        probe.close()
    if not recover_stale:
        raise H2DS4Error(Code.CONFLICT, 'stale socket: rerun with --recover-stale')
    sock.unlink()  # proven stale: we hold the data-dir lock and nobody answers


def admin_token(data_dir: Path) -> str:
    path = data_dir / 'admin.token'
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        st = os.fstat(fd)
        if st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o600:
            os.close(fd)
            raise H2DS4Error(Code.POLICY_DENIED, 'admin token must be a 0600 file')
        with os.fdopen(fd) as f:
            return f.read().strip()
    except FileNotFoundError:
        token = secrets.token_urlsafe(32)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as f:
            f.write(token + '\n')
        return token


def bind_uds(path: Path) -> socket.socket:
    old = os.umask(0o077)
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.bind(str(path))
        os.chmod(path, 0o600)
        sock.listen(16)
    finally:
        os.umask(old)
    st = path.lstat()
    if stat.S_IMODE(st.st_mode) != 0o600 or st.st_uid != os.getuid():
        sock.close()
        raise H2DS4Error(Code.POLICY_DENIED, 'socket permissions not 0600 after bind')
    return sock


@dataclass
class Sidecar:
    settings: Settings
    store: SqliteStore
    service: Service
    worker: Worker | None
    app: Any
    lock_fd: int


def build(settings: Settings, *, fixtures_root: Path = FIXTURES_ROOT) -> Sidecar:
    if not settings.service.enabled:
        raise H2DS4Error(Code.POLICY_DENIED, 'service.enabled is false (default): refusing to '
                         'start')
    prepare_dirs(settings)
    lock = acquire_lock(settings.data_dir)
    try:
        store = SqliteStore(settings.db_path).initialize()
        blobs = BlobStore(settings.data_dir / 'blob')
        service = Service(settings, store, blobs, fixtures_root)
        service.overlays.reconcile()
        worker = None
        if settings.service.mode in (Mode.LAB, Mode.PROPOSE, Mode.APPROVED):
            worker = Worker(store, Engine(settings, store, blobs, fixtures_root))
            worker.recover()
        app = create_app(service, admin_token=admin_token(settings.data_dir))
    except BaseException:
        os.close(lock)
        raise
    return Sidecar(settings, store, service, worker, app, lock)


def _server_class():
    import signal
    from contextlib import contextmanager

    import uvicorn

    class GracefulServer(uvicorn.Server):
        """uvicorn re-raises SIGTERM/SIGINT after shutdown, which kills the process before
        serve()'s cleanup (socket unlink, worker stop, lock release). Capture without
        re-raising so the sidecar always exits through its own cleanup."""

        @contextmanager
        def capture_signals(self):
            original = {sig: signal.signal(sig, self.handle_exit)
                        for sig in (signal.SIGINT, signal.SIGTERM)}
            try:
                yield
            finally:
                for sig, handler in original.items():
                    signal.signal(sig, handler)

    return GracefulServer


def serve(settings: Settings, *, recover_stale: bool = False) -> None:
    import uvicorn

    sc = build(settings)
    sock_path = settings.uds_path
    check_socket_path(sock_path, recover_stale=recover_stale)
    sock = bind_uds(sock_path)
    if sc.worker is not None:
        sc.worker.start()
    config = uvicorn.Config(sc.app, fd=sock.fileno(), workers=1, access_log=False,
                            log_level='warning', timeout_keep_alive=5, lifespan='off',
                            server_header=False, date_header=False)
    try:
        _server_class()(config).run()
    finally:
        if sc.worker is not None:
            sc.worker.stop()
        sock.close()
        try:
            if sock_path.is_socket() and sock_path.lstat().st_uid == os.getuid():
                sock_path.unlink()
        except FileNotFoundError:
            pass
        os.close(sc.lock_fd)
