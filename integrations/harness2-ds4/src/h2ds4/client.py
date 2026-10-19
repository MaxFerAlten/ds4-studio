"""Python UDS client for the sidecar API (used by the CLI)."""

from __future__ import annotations

import uuid
from pathlib import Path

import httpx

from .errors import Code, H2DS4Error


class SidecarClient:
    def __init__(self, socket_path: Path, *, admin_token: str | None = None, timeout: float = 10):
        if not socket_path.is_socket():
            raise H2DS4Error(Code.UPSTREAM_UNAVAILABLE, 'sidecar not running (no socket)')
        self.http = httpx.Client(transport=httpx.HTTPTransport(uds=str(socket_path)),
                                 base_url='http://h2ds4', timeout=timeout, trust_env=False)
        self.admin_token = admin_token

    def _req(self, method: str, path: str, body: dict | None = None, *, admin: bool = False,
             idem: str | None = None) -> dict:
        headers = {'X-H2DS4-Protocol': '1', 'X-Request-Id': str(uuid.uuid4())}
        if admin:
            if not self.admin_token:
                raise H2DS4Error(Code.UNAUTHORIZED, 'admin token unavailable')
            headers['Authorization'] = f'Bearer {self.admin_token}'
        if idem:
            headers['Idempotency-Key'] = idem
        try:
            r = self.http.request(method, path, json=body, headers=headers)
        except httpx.TransportError as e:
            raise H2DS4Error(Code.UPSTREAM_UNAVAILABLE, type(e).__name__) from e
        if r.headers.get('content-type', '').split(';')[0] != 'application/json':
            raise H2DS4Error(Code.PROTOCOL_ERROR, 'non-JSON response')
        data = r.json()
        if r.status_code >= 400:
            try:
                code = Code(data.get('error', 'INTERNAL_ERROR'))
            except ValueError:
                code = Code.INTERNAL_ERROR
            raise H2DS4Error(code, data.get('detail', ''))
        return data

    def get(self, path: str, *, admin: bool = False) -> dict:
        return self._req('GET', path, admin=admin)

    def post(self, path: str, body: dict | None = None, *, admin: bool = False,
             idem: str | None = None) -> dict:
        return self._req('POST', path, body or {}, admin=admin, idem=idem)
