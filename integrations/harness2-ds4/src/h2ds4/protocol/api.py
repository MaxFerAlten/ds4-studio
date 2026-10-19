"""HTTP-over-UDS control API (plan §12, §30.4, §30.6).

- `X-H2DS4-Protocol: 1` on every /v1 route (426 otherwise);
- 1 MiB body cap and Transfer-Encoding/Content-Length checks in a raw ASGI middleware,
  before any parsing;
- admin routes (approve/activate/rollback/audit) need the bearer token from the 0600
  token file; read routes need none (the 0600 socket already limits callers to this uid);
- errors are stable reason codes, never stack traces or paths;
- no docs/openapi routes, no generic execute endpoint.
"""

from __future__ import annotations

import hmac
import json
from collections import deque
from collections.abc import Callable
from threading import Lock
from time import monotonic
from typing import Any

from fastapi import Body, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..errors import Code, H2DS4Error
from ..models import ApprovalRequest, ExperimentCreate, RollbackRequest, safe_id
from ..service import Service

MAX_BODY = 1 << 20
MAX_HEADER = 8192

ASGIApp = Any


def _err(code: Code, detail: str = '') -> JSONResponse:
    return JSONResponse(H2DS4Error(code, detail).body(), status_code=H2DS4Error(code).http_status)


class BodyLimit:
    """Reject oversize/ambiguous bodies before the framework reads them."""

    def __init__(self, app: ASGIApp, max_body: int = MAX_BODY,
                 requests_per_minute: int = 120, rate_window_s: float = 60.0):
        if type(requests_per_minute) is not int or requests_per_minute < 1:
            raise ValueError('requests_per_minute must be positive')
        if not isinstance(rate_window_s, (int, float)) or rate_window_s <= 0:
            raise ValueError('rate_window_s must be positive')
        self.app = app
        self.max_body = max_body
        self.requests_per_minute = requests_per_minute
        self.rate_window_s = float(rate_window_s)
        self._request_times = deque()
        self._rate_lock = Lock()

    def _rate_limited(self, scope: dict) -> bool:
        if not scope.get('path', '').startswith('/v1/'):
            return False
        now = monotonic()
        with self._rate_lock:
            while self._request_times and now - self._request_times[0] >= self.rate_window_s:
                self._request_times.popleft()
            if len(self._request_times) >= self.requests_per_minute:
                return True
            self._request_times.append(now)
            return False

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        headers = {k.lower(): v for k, v in scope.get('headers', [])}
        if self._rate_limited(scope):
            return await _err(Code.RATE_LIMITED, 'request rate exceeded')(scope, receive, send)
        if any(len(v) > MAX_HEADER for v in headers.values()):
            return await _err(Code.TOO_LARGE, 'header too large')(scope, receive, send)
        te = headers.get(b'transfer-encoding')
        cl = headers.get(b'content-length')
        if te is not None:
            return await _err(Code.INVALID_INPUT, 'chunked bodies not accepted')(
                scope, receive, send)
        if cl is not None:
            try:
                n = int(cl)
            except ValueError:
                return await _err(Code.INVALID_INPUT, 'bad Content-Length')(scope, receive, send)
            if n < 0 or n > self.max_body:
                return await _err(Code.TOO_LARGE, 'body too large')(scope, receive, send)
        seen = 0

        async def capped() -> dict:
            nonlocal seen
            msg = await receive()
            if msg['type'] == 'http.request':
                seen += len(msg.get('body', b''))
                if seen > self.max_body:
                    raise H2DS4Error(Code.TOO_LARGE, 'body too large')
            return msg

        return await self.app(scope, capped, send)


def create_app(service: Service, *, admin_token: str, expected_protocol: str = '1',
               requests_per_minute: int = 120) -> Any:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(H2DS4Error)
    async def _h2(_req: Request, exc: H2DS4Error) -> JSONResponse:
        return JSONResponse(exc.body(), status_code=exc.http_status)

    @app.exception_handler(RequestValidationError)
    async def _val(_req: Request, exc: RequestValidationError) -> JSONResponse:
        locs = sorted({'.'.join(str(x) for x in e.get('loc', [])[1:]) for e in exc.errors()})
        return _err(Code.INVALID_INPUT, f'invalid fields: {locs[:8]}')

    @app.exception_handler(StarletteHTTPException)
    async def _http(_req: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: Code.NOT_SUPPORTED, 405: Code.METHOD_NOT_ALLOWED}.get(exc.status_code,
                                                                          Code.INVALID_INPUT)
        return _err(code)

    @app.exception_handler(Exception)
    async def _any(_req: Request, _exc: Exception) -> JSONResponse:
        return _err(Code.INTERNAL_ERROR)

    def proto(value: str | None) -> None:
        if value != expected_protocol:
            raise H2DS4Error(Code.BAD_PROTOCOL, 'X-H2DS4-Protocol: 1 required')

    def admin(authorization: str | None) -> None:
        if not authorization or not authorization.startswith('Bearer '):
            raise H2DS4Error(Code.UNAUTHORIZED, 'admin token required')
        if not hmac.compare_digest(authorization[7:].encode(), admin_token.encode()):
            raise H2DS4Error(Code.FORBIDDEN, 'admin token rejected')

    def idem_key(value: str | None) -> str:
        if not value or len(value) > 80:
            raise H2DS4Error(Code.INVALID_INPUT, 'IDEMPOTENCY_KEY_REQUIRED')
        return value

    def exp_id(value: str) -> str:
        try:
            return safe_id(value)
        except ValueError as e:
            raise H2DS4Error(Code.INVALID_INPUT, 'bad experiment id') from e

    P = Header(default=None, alias='X-H2DS4-Protocol')

    @app.get('/health/live')
    async def live() -> dict:
        return {'status': 'live', 'protocol': 1}

    @app.get('/health/ready')
    async def ready() -> dict:
        # Storage/policy only: never contacts or loads a model.
        with service.store.read() as db:
            db.execute('SELECT 1').fetchone()
        return {'status': 'ready', 'mode': str(service.s.service.mode)}

    @app.get('/v1/capabilities')
    async def capabilities(x: str | None = P) -> dict:
        proto(x)
        return service.capabilities()

    @app.post('/v1/experiments', status_code=201)
    async def create(request: ExperimentCreate, x: str | None = P,
                     idempotency_key: str | None = Header(default=None)) -> dict:
        proto(x)
        return service.create_experiment(request, idem_key(idempotency_key))

    @app.get('/v1/experiments')
    async def listing(x: str | None = P) -> dict:
        proto(x)
        return {'experiments': service.list_experiments()}

    @app.get('/v1/experiments/{eid}')
    async def get(eid: str, x: str | None = P) -> dict:
        proto(x)
        return service.get_experiment(exp_id(eid))

    @app.post('/v1/experiments/{eid}/run')
    async def run(eid: str, x: str | None = P,
                  idempotency_key: str | None = Header(default=None),
                  body: dict = Body(default_factory=dict)) -> dict:
        proto(x)
        if set(body) - {'maintenance_ack'}:
            raise H2DS4Error(Code.INVALID_INPUT, 'unknown fields')
        return service.queue_run(exp_id(eid), idem_key(idempotency_key),
                                 maintenance_ack=str(body.get('maintenance_ack', '')))

    @app.post('/v1/experiments/{eid}/cancel')
    async def cancel(eid: str, x: str | None = P) -> dict:
        proto(x)
        return service.cancel(exp_id(eid))

    @app.get('/v1/experiments/{eid}/candidates')
    async def candidates(eid: str, x: str | None = P) -> dict:
        proto(x)
        return {'candidates': service.candidates(exp_id(eid))}

    @app.get('/v1/experiments/{eid}/evidence')
    async def evidence(eid: str, x: str | None = P) -> dict:
        proto(x)
        return service.evidence(exp_id(eid))

    @app.get('/v1/overlays')
    async def overlays(x: str | None = P) -> dict:
        proto(x)
        return service.overlays.status()

    @app.post('/v1/overlays/{oid}/approve')
    async def approve(oid: str, request: ApprovalRequest, x: str | None = P,
                      authorization: str | None = Header(default=None)) -> dict:
        proto(x)
        admin(authorization)
        return service.approve(exp_id(oid), expected_active_digest=request.expected_active_digest,
                               reason=request.reason)

    @app.post('/v1/overlays/{oid}/validate')
    async def validate(oid: str, x: str | None = P,
                       authorization: str | None = Header(default=None)) -> dict:
        proto(x)
        admin(authorization)
        return service.validate_overlay(exp_id(oid))

    @app.post('/v1/overlays/{oid}/activate')
    async def activate(oid: str, request: RollbackRequest, x: str | None = P,
                       authorization: str | None = Header(default=None)) -> dict:
        proto(x)
        admin(authorization)
        return service.activate(exp_id(oid), expected_revision=request.expected_revision,
                                reason=request.reason)

    @app.post('/v1/overlays/rollback')
    async def rollback(request: RollbackRequest, x: str | None = P,
                       authorization: str | None = Header(default=None)) -> dict:
        proto(x)
        admin(authorization)
        return service.rollback(expected_revision=request.expected_revision,
                                reason=request.reason)

    @app.get('/v1/audit')
    async def audit(x: str | None = P, authorization: str | None = Header(default=None),
                    after: int = 0, limit: int = 100) -> dict:
        proto(x)
        admin(authorization)
        return service.audit(after=after, limit=limit)

    return BodyLimit(app, requests_per_minute=requests_per_minute)


def json_dumps(obj: object) -> str:
    return json.dumps(obj, sort_keys=True)
