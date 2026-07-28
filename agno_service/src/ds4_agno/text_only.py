from __future__ import annotations

import json
import re
from typing import Any

_MEDIA_KEYS = {
    "audio",
    "file",
    "files",
    "image",
    "images",
    "input_audio",
    "input_image",
    "video",
    "videos",
}
_AGENT_OS_RUN_PATH = re.compile(r"^/(?:agents|teams)/[^/]+/runs/?$")
_CONTEXT_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
_FILES_PART_RE = re.compile(
    rb'content-disposition\s*:\s*form-data'
    rb'(?=[^\r\n]*\bname="files")'
    rb'(?=[^\r\n]*\bfilename="([^"]+)")',
    re.IGNORECASE,
)


class TextOnlyInputGuard:
    ERROR_CODE = "AGNO_TEXT_ONLY"

    @staticmethod
    def contains_media_fields(payload: object) -> bool:
        if isinstance(payload, list):
            return any(
                TextOnlyInputGuard.contains_media_fields(item)
                for item in payload
            )
        if not isinstance(payload, dict):
            return False
        for key, value in payload.items():
            if key in _MEDIA_KEYS and value is not None:
                return True
            if key == "type" and value in {
                "audio",
                "file",
                "image_url",
                "input_audio",
                "input_image",
                "video",
            }:
                return True
            if TextOnlyInputGuard.contains_media_fields(value):
                return True
        return False

    @staticmethod
    def validate_ds4_payload(payload: object) -> str:
        if not isinstance(payload, dict):
            raise ValueError("request body must be a JSON object")
        if TextOnlyInputGuard.contains_media_fields(payload):
            raise ValueError("media input is not supported")
        message = payload.get("message")
        if not isinstance(message, str) or not message.strip():
            raise ValueError("message must be a non-empty string")
        stream = payload.get("stream", True)
        if not isinstance(stream, bool):
            raise ValueError("stream must be a boolean")
        session_id = payload.get("sessionId")
        if session_id is not None and (
            not isinstance(session_id, str)
            or not _CONTEXT_ID_RE.fullmatch(session_id)
        ):
            raise ValueError("sessionId is invalid")
        return message


class RejectAgentOsMediaMiddleware:
    def __init__(
        self,
        app,
        *,
        max_inspection_bytes: int = 1_048_576,
    ) -> None:
        self.app = app
        self.max_inspection_bytes = max_inspection_bytes

    async def __call__(self, scope, receive, send) -> None:
        if (
            scope.get("type") != "http"
            or scope.get("method") != "POST"
            or not _AGENT_OS_RUN_PATH.fullmatch(scope.get("path", ""))
        ):
            await self.app(scope, receive, send)
            return

        headers = {
            key.lower(): value
            for key, value in scope.get("headers", [])
        }
        content_type = headers.get(b"content-type", b"").lower()
        if b"multipart/form-data" not in content_type:
            await self.app(scope, receive, send)
            return

        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                if int(content_length) > self.max_inspection_bytes:
                    await self._reject(
                        send,
                        413,
                        "AGNO_INPUT_TOO_LARGE",
                        "multipart request exceeds inspection limit",
                    )
                    return
            except ValueError:
                await self._reject(
                    send,
                    400,
                    "INVALID_REQUEST_BODY",
                    "invalid content length",
                )
                return

        chunks: list[bytes] = []
        size = 0
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                return
            if event["type"] != "http.request":
                continue
            chunk = event.get("body", b"")
            size += len(chunk)
            if size > self.max_inspection_bytes:
                await self._reject(
                    send,
                    413,
                    "AGNO_INPUT_TOO_LARGE",
                    "multipart request exceeds inspection limit",
                )
                return
            chunks.append(chunk)
            if not event.get("more_body", False):
                break

        body = b"".join(chunks)
        match = _FILES_PART_RE.search(body)
        if match is not None and match.group(1):
            await self._reject(
                send,
                415,
                TextOnlyInputGuard.ERROR_CODE,
                "file attachments are not supported",
            )
            return

        replayed = False

        async def replay_receive():
            nonlocal replayed
            if replayed:
                return {"type": "http.request", "body": b"", "more_body": False}
            replayed = True
            return {
                "type": "http.request",
                "body": body,
                "more_body": False,
            }

        await self.app(scope, replay_receive, send)

    @staticmethod
    async def _reject(send, status: int, code: str, message: str) -> None:
        body = json.dumps(
            {"error": code, "message": message},
            separators=(",", ":"),
        ).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": body,
                "more_body": False,
            },
        )
