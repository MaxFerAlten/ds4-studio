"""Read-only DS4 integrity monitor and discovery (plan §3.3, §9, §38.3, WP00).

Same tracked-file algorithm as scripts/audit-upstream.sh. Never writes inside the
checkout: git runs with GIT_OPTIONAL_LOCKS=0 and files are opened O_RDONLY|O_NOFOLLOW.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
from pathlib import Path

from .canonical import canonical_json


def _git(root: Path, *args: str) -> bytes:
    env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
    return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True,
                          env=env, timeout=120).stdout


def _digest_file(p: Path) -> dict:
    try:
        st = os.lstat(p)
    except FileNotFoundError:
        return {'kind': 'missing'}
    if stat.S_ISLNK(st.st_mode):
        return {'kind': 'symlink',
                'target_sha256': hashlib.sha256(os.readlink(p).encode()).hexdigest()}
    if stat.S_ISDIR(st.st_mode):
        return {'kind': 'dir'}
    h = hashlib.sha256()
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return {'kind': 'file', 'sha256': h.hexdigest(), 'size': st.st_size,
            'mode': oct(stat.S_IMODE(st.st_mode))}


def fingerprint(root: Path) -> dict:
    root = Path(os.path.realpath(root))
    tracked = {}
    for row in _git(root, 'ls-files', '-s', '-z').split(b'\0'):
        if not row:
            continue
        meta, path = row.split(b'\t', 1)
        mode, blob, _ = meta.decode().split()
        rel = path.decode('utf-8', 'surrogateescape')
        tracked[rel] = {'index_mode': mode, 'index_blob': blob, **_digest_file(root / rel)}
    manifest = json.dumps(tracked, sort_keys=True, separators=(',', ':')).encode()
    try:
        head = _git(root, 'rev-parse', 'HEAD').decode().strip()
    except subprocess.CalledProcessError:
        head = None  # repository without commits
    return {'root': str(root), 'head': head,
            'tracked_count': len(tracked),
            'tracked_manifest_sha256': hashlib.sha256(manifest).hexdigest()}


def snapshot_digest(fps: list[dict]) -> str:
    return 'sha256:' + hashlib.sha256(canonical_json(
        sorted((f['root'], f['head'], f['tracked_manifest_sha256']) for f in fps))).hexdigest()


def _read(p: Path, limit: int = 8 << 20) -> str:
    try:
        fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError:
        return ''
    with os.fdopen(fd, 'rb') as f:
        return f.read(limit).decode('utf-8', errors='replace')


def _lines(text: str, rx: re.Pattern[str]) -> list[int]:
    return [i + 1 for i, ln in enumerate(text.splitlines()) if rx.search(ln)]


def discover(root: Path) -> dict:
    """Static capability discovery. true|false|unknown, with file:line evidence."""
    root = Path(os.path.realpath(root))
    srun = _read(root / 'srun.sh')
    index = _read(root / 'frontend' / 'server' / 'index.mjs')
    server_c = _read(root / 'ds4_server.c', 64 << 20)
    skill_state = _read(root / 'frontend' / 'server' / 'agentSystemText.mjs')
    try:
        ui_cfg = json.loads(_read(root / 'frontend' / 'ds4-ui.config.json'))
    except ValueError:
        ui_cfg = {}
    routes = sorted(set(re.findall(r'app\.(?:get|post|put|delete)\("([^"]+)"', index)))
    v1 = sorted(set(re.findall(r'hr\.path, "(/v1/[^"]+)"', server_c)))
    ev: dict[str, list[str]] = {}

    def at(name: str, path: str, text: str, pattern: str) -> bool:
        lines = _lines(text, re.compile(pattern))
        if lines:
            ev[name] = [f'{path}:{n}' for n in lines[:5]]
        return bool(lines)

    tri = {True: 'true', False: 'false'}
    caps = {
        'openai_models_route': tri['/v1/models' in v1],
        'openai_chat_route': tri['/v1/chat/completions' in v1],
        'token_count_route': tri[any('token' in r for r in v1)],
        'chat_tools_param': tri[at('chat_tools_param', 'ds4_server.c', server_c,
                                   r'!strcmp\(key, "tools"\)')],
        'stream_include_usage': tri[at('stream_include_usage', 'ds4_server.c', server_c,
                                       r'include_usage')],
        'http_busy_reservation': 'false' if at('model_busy_internal', 'ds4_server.c', server_c,
                                               r'model_busy') else 'unknown',
        'skills_dir_bootstrap_env': tri[at('skills_dir_bootstrap_env', 'srun.sh', srun,
                                           r'DS4_SKILLS_DIR')],
        'skills_dir_read_by_js_loop': tri[at('skills_dir_read_by_js_loop',
                                             'frontend/server/agentSystemText.mjs', skill_state,
                                             r'DS4_SKILLS_DIR')],
        'per_request_skill_override': 'false',
        'agent_chat_route': tri['/api/agent/chat' in routes],
        'run_status_cancel_routes': tri['/api/runs/:runId' in routes
                                        and '/api/runs/:runId/cancel' in routes],
        'isolated_task_workspace_api': 'false',
        'trace_export_api': 'unknown',
        'wrapper_mode_switch_route': tri['/api/wrapper/switch-mode' in routes],
        'plugin_extension_routes': 'false' if routes else 'unknown',
        'live_model_reachable': 'unknown',
    }
    server = ui_cfg.get('server', {}) if isinstance(ui_cfg, dict) else {}
    return {'root': str(root), 'capabilities': caps, 'evidence': ev,
            'node_routes': routes, 'ds4_server_v1_routes': v1,
            'configured_backend_port': server.get('port'),
            'configured_ui_port': (ui_cfg.get('ui') or {}).get('port')
            if isinstance(ui_cfg, dict) else None}
