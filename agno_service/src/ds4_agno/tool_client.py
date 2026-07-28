from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import re
from typing import Any

import httpx

from .tool_errors import Ds4ToolBridgeError


_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
_NAME_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
_ERROR_MESSAGE_LIMIT = 512


@dataclass(frozen=True)
class ToolCatalog:
    protocol_version: int
    profile: str
    tools: tuple[dict[str, Any], ...]
    catalog_digest: str


@dataclass(frozen=True)
class ToolBridgeResult:
    tool_name: str
    content: str
    is_error: bool
    guarded: bool
    compressed: bool
    code: str | None
    raw: dict[str, Any] | list[Any] | str | None
    duration_ms: float | None


def _safe_message(value: object, fallback: str) -> str:
    if not isinstance(value, str) or not value.strip():
        return fallback
    return " ".join(value.split())[:_ERROR_MESSAGE_LIMIT]


def canonical_catalog_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def catalog_digest(tools: object) -> str:
    encoded = canonical_catalog_json(tools).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def decode_json_response(response: httpx.Response) -> dict[str, Any]:
    try:
        data = response.json()
    except ValueError as exc:
        raise Ds4ToolBridgeError(
            "INVALID_BRIDGE_RESPONSE",
            "tool bridge returned non-JSON",
            status_code=response.status_code,
        ) from exc

    if not isinstance(data, dict):
        raise Ds4ToolBridgeError(
            "INVALID_BRIDGE_RESPONSE",
            "tool bridge returned a non-object payload",
            status_code=response.status_code,
        )

    if not 200 <= response.status_code < 300:
        code = data.get("error")
        if not isinstance(code, str) or not _NAME_RE.fullmatch(code):
            code = "TOOL_BRIDGE_HTTP_ERROR"
        raise Ds4ToolBridgeError(
            code,
            _safe_message(data.get("message"), "tool bridge request failed"),
            status_code=response.status_code,
        )
    return data


def parse_catalog_payload(data: dict[str, Any]) -> ToolCatalog:
    if data.get("protocolVersion") != 1:
        raise Ds4ToolBridgeError(
            "INVALID_TOOL_CATALOG",
            "tool catalog protocol version is invalid",
        )
    profile = data.get("profile")
    if profile not in {"safe", "full"}:
        raise Ds4ToolBridgeError(
            "INVALID_TOOL_CATALOG",
            "tool catalog profile is invalid",
        )
    tools = data.get("tools")
    if not isinstance(tools, list) or not tools:
        raise Ds4ToolBridgeError(
            "INVALID_TOOL_CATALOG",
            "tool catalog must contain tools",
        )

    names: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for entry in tools:
        if not isinstance(entry, dict) or entry.get("type") != "function":
            raise Ds4ToolBridgeError(
                "INVALID_TOOL_CATALOG",
                "tool catalog entry is invalid",
            )
        function = entry.get("function")
        if not isinstance(function, dict):
            raise Ds4ToolBridgeError(
                "INVALID_TOOL_CATALOG",
                "tool function definition is invalid",
            )
        name = function.get("name")
        description = function.get("description")
        parameters = function.get("parameters")
        if (
            not isinstance(name, str)
            or not _NAME_RE.fullmatch(name)
            or name in names
        ):
            raise Ds4ToolBridgeError(
                "INVALID_TOOL_CATALOG",
                "tool name is invalid or duplicated",
            )
        if not isinstance(description, str):
            raise Ds4ToolBridgeError(
                "INVALID_TOOL_CATALOG",
                "tool description is invalid",
            )
        if not isinstance(parameters, dict) or parameters.get("type") != "object":
            raise Ds4ToolBridgeError(
                "INVALID_TOOL_CATALOG",
                "tool parameter schema is invalid",
            )
        names.add(name)
        normalized.append(entry)

    digest = data.get("catalogDigest")
    if not isinstance(digest, str) or not _DIGEST_RE.fullmatch(digest):
        raise Ds4ToolBridgeError(
            "INVALID_TOOL_CATALOG",
            "tool catalog digest is invalid",
        )
    if digest != catalog_digest(normalized):
        raise Ds4ToolBridgeError(
            "INVALID_TOOL_CATALOG",
            "tool catalog digest does not match payload",
        )

    return ToolCatalog(
        protocol_version=1,
        profile=profile,
        tools=tuple(normalized),
        catalog_digest=digest,
    )


def _parse_execute_payload(data: dict[str, Any]) -> ToolBridgeResult:
    required = {
        "ok",
        "toolName",
        "content",
        "isError",
        "guarded",
        "compressed",
        "code",
        "raw",
        "durationMs",
    }
    if not required.issubset(data):
        raise Ds4ToolBridgeError(
            "INVALID_BRIDGE_RESPONSE",
            "tool bridge result is incomplete",
        )
    if not isinstance(data["toolName"], str) or not isinstance(data["content"], str):
        raise Ds4ToolBridgeError(
            "INVALID_BRIDGE_RESPONSE",
            "tool bridge result contains invalid text fields",
        )
    for key in ("ok", "isError", "guarded", "compressed"):
        if not isinstance(data[key], bool):
            raise Ds4ToolBridgeError(
                "INVALID_BRIDGE_RESPONSE",
                "tool bridge result contains invalid boolean fields",
            )
    code = data["code"]
    if code is not None and not isinstance(code, str):
        raise Ds4ToolBridgeError(
            "INVALID_BRIDGE_RESPONSE",
            "tool bridge result contains an invalid code",
        )
    raw = data["raw"]
    if raw is not None and not isinstance(raw, (dict, list, str)):
        raise Ds4ToolBridgeError(
            "INVALID_BRIDGE_RESPONSE",
            "tool bridge result contains an invalid raw payload",
        )
    duration = data["durationMs"]
    if duration is not None and (
        isinstance(duration, bool) or not isinstance(duration, (int, float))
    ):
        raise Ds4ToolBridgeError(
            "INVALID_BRIDGE_RESPONSE",
            "tool bridge result contains an invalid duration",
        )
    if data["ok"] == data["isError"]:
        raise Ds4ToolBridgeError(
            "INVALID_BRIDGE_RESPONSE",
            "tool bridge result success flags are inconsistent",
        )
    return ToolBridgeResult(
        tool_name=data["toolName"],
        content=data["content"],
        is_error=data["isError"],
        guarded=data["guarded"],
        compressed=data["compressed"],
        code=code,
        raw=raw,
        duration_ms=float(duration) if duration is not None else None,
    )


class Ds4ToolBridgeClient:
    def __init__(
        self,
        *,
        base_url: str,
        token: str,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._closed = False
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
            trust_env=False,
            follow_redirects=False,
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            response = await self._client.request(
                method,
                f"{self._base_url}/{path}",
                json=json_body,
            )
        except httpx.TimeoutException as exc:
            raise Ds4ToolBridgeError(
                "TOOL_BRIDGE_TIMEOUT",
                "tool bridge request timed out",
            ) from exc
        except httpx.RequestError as exc:
            raise Ds4ToolBridgeError(
                "TOOL_BRIDGE_UNAVAILABLE",
                "tool bridge is unavailable",
            ) from exc
        return decode_json_response(response)

    async def get_catalog(self) -> ToolCatalog:
        return parse_catalog_payload(await self._request("GET", "catalog"))

    async def execute(
        self,
        *,
        call_id: str,
        tool_name: str,
        arguments: dict[str, Any],
        context: dict[str, Any],
    ) -> ToolBridgeResult:
        data = await self._request(
            "POST",
            "execute",
            json_body={
                "protocolVersion": 1,
                "callId": call_id,
                "toolName": tool_name,
                "arguments": arguments,
                "context": context,
            },
        )
        return _parse_execute_payload(data)

    async def cancel(self, *, run_id: str, session_id: str) -> None:
        data = await self._request(
            "POST",
            "cancel",
            json_body={
                "protocolVersion": 1,
                "runId": run_id,
                "sessionId": session_id,
            },
        )
        if data.get("ok") is not True:
            raise Ds4ToolBridgeError(
                "INVALID_BRIDGE_RESPONSE",
                "tool bridge cancellation acknowledgement is invalid",
            )

    async def status(self) -> dict[str, Any]:
        return await self._request("GET", "status")

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._client.aclose()


def get_catalog_sync(
    *,
    base_url: str,
    token: str,
    timeout_seconds: float,
    transport: httpx.BaseTransport | None = None,
) -> ToolCatalog:
    normalized_base_url = base_url.rstrip("/")
    try:
        with httpx.Client(
            base_url=normalized_base_url,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(timeout_seconds),
            transport=transport,
            trust_env=False,
            follow_redirects=False,
        ) as client:
            response = client.get(f"{normalized_base_url}/catalog")
    except httpx.TimeoutException as exc:
        raise Ds4ToolBridgeError(
            "TOOL_BRIDGE_TIMEOUT",
            "tool bridge catalog request timed out",
        ) from exc
    except httpx.RequestError as exc:
        raise Ds4ToolBridgeError(
            "TOOL_BRIDGE_UNAVAILABLE",
            "tool bridge is unavailable",
        ) from exc
    return parse_catalog_payload(decode_json_response(response))
