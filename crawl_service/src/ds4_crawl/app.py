from __future__ import annotations

import json
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import Response, StreamingResponse

from .artifacts import ArtifactStore
from .auth import verify_bearer
from .models import CrawlRequest
from .parity import parity_manifest
from .repository import Repository
from .runner import CrawlRunner
from .serialize import serialize_result
from .sessions import SessionManager
from .settings import Settings as CrawlSettings


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    settings = CrawlSettings.load()
    token = settings.ensure_token()
    repository = Repository(settings.database_path)
    artifact_store = ArtifactStore(settings.artifact_dir)
    runner = CrawlRunner(repository, artifact_store)
    session_manager = SessionManager(repository)
    app.state.settings = settings
    app.state.token = token
    app.state.repository = repository
    app.state.artifact_store = artifact_store
    app.state.runner = runner
    app.state.session_manager = session_manager
    yield
    await runner.close()
    repository.close()


app = FastAPI(lifespan=_lifespan, title="ds4-crawl-service", version="0.1.0")


def _auth(request: Request) -> None:
    verify_bearer(request.headers.get("Authorization"), request.app.state.token)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ds4-crawl-service"}


@app.post("/jobs")
async def create_job(request: Request, body: CrawlRequest):
    _auth(request)
    repo: Repository = request.app.state.repository
    runner: CrawlRunner = request.app.state.runner

    payload = body.model_dump(mode="json", exclude_none=True)
    job_id = f"job-{uuid.uuid4().hex[:12]}"
    repo.create_job(job_id, payload)
    runner.submit(job_id)
    return {"job_id": job_id, "state": "queued"}


@app.get("/jobs/{job_id}")
async def get_job(request: Request, job_id: str):
    _auth(request)
    repo: Repository = request.app.state.repository
    job = repo.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    result = {
        "job_id": job["id"],
        "state": job["state"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
    }
    if job["result_manifest_json"]:
        result["result_manifest"] = json.loads(job["result_manifest_json"])
    if job["error_json"]:
        result["error"] = json.loads(job["error_json"])
    return result


@app.get("/jobs/{job_id}/events")
async def stream_job_events(request: Request, job_id: str):
    _auth(request)
    repo: Repository = request.app.state.repository

    async def event_stream() -> AsyncGenerator[bytes, None]:
        last_id = 0
        while True:
            rows = repo.connection.execute(
                "SELECT event_id, event_type, payload_json, created_at FROM events WHERE job_id = ? AND event_id > ? ORDER BY event_id",
                (job_id, last_id),
            ).fetchall()
            for row in rows:
                data = json.dumps({"event": row["event_type"], "data": json.loads(row["payload_json"]), "created_at": row["created_at"]})
                yield f"id: {row['event_id']}\nevent: {row['event_type']}\ndata: {data}\n\n".encode()
                last_id = row["event_id"]
            job = repo.get_job(job_id)
            if job and job["state"] in ("succeeded", "partially_succeeded", "failed", "cancelled"):
                yield b"event: done\ndata: {}\n\n"
                return
            import asyncio
            await asyncio.sleep(0.5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.delete("/jobs/{job_id}")
async def cancel_job(request: Request, job_id: str):
    _auth(request)
    runner: CrawlRunner = request.app.state.runner
    await runner.cancel_job(job_id)
    return {"job_id": job_id, "state": "cancelling"}


@app.post("/sessions")
async def open_session(request: Request):
    _auth(request)
    repo: Repository = request.app.state.repository
    sm = SessionManager(repo)
    result = sm.open()
    return result


@app.get("/sessions/{session_id}")
async def get_session(request: Request, session_id: str):
    _auth(request)
    repo: Repository = request.app.state.repository
    session = repo.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return {"session_id": session["id"], "state": session["state"]}


@app.delete("/sessions/{session_id}")
async def close_session(request: Request, session_id: str):
    _auth(request)
    repo: Repository = request.app.state.repository
    sm = SessionManager(repo)
    ok = sm.close(session_id)
    return {"closed": ok}


@app.get("/artifacts/{artifact_id}")
async def get_artifact(request: Request, artifact_id: str):
    _auth(request)
    store: ArtifactStore = request.app.state.artifact_store
    try:
        data = store.get(artifact_id)
        return Response(content=data, media_type="application/octet-stream")
    except (ValueError, FileNotFoundError):
        raise HTTPException(status_code=404, detail="artifact not found")


@app.get("/schema")
async def schema():
    return parity_manifest()
