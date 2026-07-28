from __future__ import annotations

import json

import pytest

from ds4_agno.text_only import (
    RejectAgentOsMediaMiddleware,
    TextOnlyInputGuard,
)


def test_custom_run_payload_accepts_only_non_empty_text():
    assert TextOnlyInputGuard.validate_ds4_payload(
        {"message": "hello", "stream": True}
    ) == "hello"

    for payload in [
        {"message": ""},
        {"message": {"text": "hello"}},
        {"message": "hello", "stream": "true"},
        {"message": "hello", "sessionId": "../../etc"},
        {"message": "hello", "images": ["data:image/png;base64,AA=="]},
        {
            "message": "hello",
            "metadata": {
                "content": [{"type": "image_url", "image_url": {}}],
            },
        },
    ]:
        with pytest.raises(ValueError):
            TextOnlyInputGuard.validate_ds4_payload(payload)


def _scope(*, path="/agents/ds4-assistant/runs", length=None):
    headers = [
        (
            b"content-type",
            b'multipart/form-data; boundary="ds4-boundary"',
        )
    ]
    if length is not None:
        headers.append((b"content-length", str(length).encode("ascii")))
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 1),
        "server": ("127.0.0.1", 7777),
    }


async def _run_middleware(body_events, *, limit=1_048_576, path=None):
    seen = {"downstream": False, "body": b""}
    sent = []
    events = list(body_events)

    async def receive():
        return events.pop(0)

    async def send(event):
        sent.append(event)

    async def downstream(_scope, downstream_receive, downstream_send):
        seen["downstream"] = True
        while True:
            event = await downstream_receive()
            seen["body"] += event.get("body", b"")
            if not event.get("more_body", False):
                break
        await downstream_send(
            {"type": "http.response.start", "status": 204, "headers": []}
        )
        await downstream_send(
            {"type": "http.response.body", "body": b"", "more_body": False}
        )

    middleware = RejectAgentOsMediaMiddleware(
        downstream,
        max_inspection_bytes=limit,
    )
    scope = _scope(path=path or "/agents/ds4-assistant/runs")
    await middleware(scope, receive, send)
    return seen, sent


@pytest.mark.asyncio
async def test_agent_os_middleware_rejects_file_across_body_chunks():
    body = (
        b"--ds4-boundary\r\n"
        b'Content-Disposition: form-data; name="message"\r\n\r\n'
        b"hello\r\n"
        b"--ds4-boundary\r\n"
        b'Content-Disposition: form-data; name="files"; '
        b'filename="image.png"\r\n'
        b"Content-Type: image/png\r\n\r\n"
        b"\x89PNG\r\n"
        b"--ds4-boundary--\r\n"
    )
    split = body.index(b'filename="image.png"') + 4
    seen, sent = await _run_middleware(
        [
            {
                "type": "http.request",
                "body": body[:split],
                "more_body": True,
            },
            {
                "type": "http.request",
                "body": body[split:],
                "more_body": False,
            },
        ]
    )

    assert seen["downstream"] is False
    assert sent[0]["status"] == 415
    payload = json.loads(sent[1]["body"])
    assert payload["error"] == "AGNO_TEXT_ONLY"
    assert "image.png" not in payload["message"]


@pytest.mark.asyncio
async def test_agent_os_middleware_replays_text_only_multipart_body():
    body = (
        b"--ds4-boundary\r\n"
        b'Content-Disposition: form-data; name="message"\r\n\r\n'
        b"hello\r\n--ds4-boundary--\r\n"
    )
    seen, sent = await _run_middleware(
        [{"type": "http.request", "body": body, "more_body": False}]
    )

    assert seen == {"downstream": True, "body": body}
    assert sent[0]["status"] == 204


@pytest.mark.asyncio
async def test_agent_os_middleware_rejects_oversized_body():
    seen, sent = await _run_middleware(
        [
            {
                "type": "http.request",
                "body": b"x" * 65,
                "more_body": False,
            }
        ],
        limit=64,
    )
    assert seen["downstream"] is False
    assert sent[0]["status"] == 413


@pytest.mark.asyncio
async def test_agent_os_middleware_stops_cleanly_on_disconnect():
    seen, sent = await _run_middleware(
        [{"type": "http.disconnect"}],
    )
    assert seen["downstream"] is False
    assert sent == []


@pytest.mark.asyncio
async def test_middleware_does_not_read_unrelated_routes():
    seen, sent = await _run_middleware(
        [{"type": "http.request", "body": b"raw", "more_body": False}],
        path="/ds4/runs",
    )
    assert seen == {"downstream": True, "body": b"raw"}
    assert sent[0]["status"] == 204
