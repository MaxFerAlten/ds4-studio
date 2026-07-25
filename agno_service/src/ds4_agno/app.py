"""FastAPI application for Agno AgentOS sidecar with full DS4 integration."""

import asyncio
import json
import os
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from ds4_agno.auth import ServiceAuthenticator
from ds4_agno.settings import Settings
from ds4_agno.db import create_db
from ds4_agno.catalog import CatalogEntry, get_default_catalog
from ds4_agno.agents import build_default_agent, build_teams, build_workflows
from ds4_agno.events import Ds4AgnoEvent
from ds4_agno.run_registry import RunRegistry
from ds4_agno.model import create_ds4_model


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    """Factory: create a FastAPI app with full AgentOS integration.

    If settings is None, loads from environment variables.
    """
    _settings = settings or Settings()
    auth = ServiceAuthenticator(expected_token=_settings.service_token)
    db = create_db(_settings)
    model = create_ds4_model(_settings)
    agents_list = [build_default_agent(model=model, db=db)]
    teams_list = build_teams(model=model, db=db, agents=agents_list)
    workflows_list = build_workflows(model=model, db=db, agents=agents_list)
    registry = RunRegistry()
    _register_agents(agents_list)

    from agno.os import AgentOS

    agent_os = AgentOS(
        id="ds4-agent-os",
        name="DS4 AgentOS",
        description="Agno AgentOS runtime supervised by DS4-Studio",
        db=db,
        agents=agents_list,
        teams=teams_list,
        workflows=workflows_list,
        telemetry=False,
        tracing=False,
        scheduler=False,
        mcp_server=False,
        cors_allowed_origins=[],
        on_route_conflict="error",
    )

    app = agent_os.get_app()

    # Mount DS4-specific routes on the same app
    @app.get("/ds4/health")
    async def health():
        return {
            "ok": True,
            "service": "ds4-agno-service",
            "owner": _settings.owner_id,
            "version": "0.1.0",
            "agnoVersion": "2.8.0",
            "pid": os.getpid(),
            "telemetry": False,
            "tracing": False,
            "scheduler": False,
            "mcp": False,
        }

    @app.get("/ds4/catalog")
    async def catalog(_request: Request):
        await auth.require(_request.headers.get("authorization"))
        catalog_items = get_default_catalog()
        return {
            "agents": [c.model_dump() for c in catalog_items if c.kind == "agent"],
            "teams": [c.model_dump() for c in catalog_items if c.kind == "team"],
            "workflows": [c.model_dump() for c in catalog_items if c.kind == "workflow"],
        }

    @app.post("/ds4/runs")
    async def create_run(request: Request):
        await auth.require(request.headers.get("authorization"))
        body = await request.json()
        target_type = body.get("targetType", "agent")
        target_id = body.get("targetId", "ds4-assistant")
        message = body.get("message", "")
        stream = body.get("stream", True)

        # Validate target exists in catalog
        catalog_items = get_default_catalog()
        found = any(c.id == target_id and c.kind == target_type for c in catalog_items)
        if not found:
            return JSONResponse(
                status_code=422,
                content={"error": f"target {target_type}/{target_id} not in catalog"},
            )

        run_id = await registry.create_run(target_type, target_id)
        coro = _execute_run(registry, run_id, target_type, target_id, message, stream)
        await registry.start_task(run_id, coro)

        return JSONResponse(
            status_code=202,
            content={
                "runId": run_id,
                "status": "queued",
                "eventsUrl": f"/ds4/runs/{run_id}/events",
            },
        )

    @app.get("/ds4/runs")
    async def list_runs(request: Request):
        await auth.require(request.headers.get("authorization"))
        records = await registry.list_runs()
        return JSONResponse(content={
            "runs": [
                {
                    "runId": r.run_id,
                    "status": r.status,
                    "targetType": r.target_type,
                    "targetId": r.target_id,
                    "createdAt": r.created_at.isoformat(),
                    "completedAt": r.completed_at.isoformat() if r.completed_at else None,
                }
                for r in records
            ]
        })

    @app.get("/ds4/runs/{run_id}")
    async def get_run(run_id: str, request: Request):
        await auth.require(request.headers.get("authorization"))
        record = await registry.get_run(run_id)
        if not record:
            return JSONResponse(status_code=404, content={"error": "run not found"})
        return JSONResponse(content={
            "runId": run_id,
            "status": record.status,
            "targetType": record.target_type,
            "targetId": record.target_id,
            "createdAt": record.created_at.isoformat(),
            "completedAt": record.completed_at.isoformat() if record.completed_at else None,
        })

    @app.get("/ds4/runs/{run_id}/events")
    async def get_run_events(run_id: str, request: Request):
        await auth.require(request.headers.get("authorization"))
        record = await registry.get_run(run_id)
        if not record:
            return JSONResponse(status_code=404, content={"error": "run not found"})

        last_seq = int(request.query_params.get("lastSeq", 0))
        # Subscribe to get new events
        queue = await registry.subscribe(run_id)

        async def event_stream():
            try:
                # Send past events that are after last_seq
                # (In a real implementation, these would be fetched from DB)
                yield f"event: run_subscribed\ndata: {json.dumps({'runId': run_id, 'seq': 0})}\n\n"
                while True:
                    event = await queue.get()
                    if event["seq"] > last_seq:
                        data = json.dumps(event)
                        yield f"event: {event['type']}\ndata: {data}\n\n"
                        if event["type"] in ("run_completed", "run_failed", "run_cancelled"):
                            break
            except asyncio.CancelledError:
                pass
            finally:
                await registry.unsubscribe(run_id, queue)

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    @app.post("/ds4/runs/{run_id}/cancel")
    async def cancel_run(run_id: str, request: Request):
        await auth.require(request.headers.get("authorization"))
        result = await registry.request_cancel(run_id)
        if not result:
            return JSONResponse(status_code=404, content={"error": "run not found"})
        return JSONResponse(content={"status": "cancelled", "runId": run_id})

    @app.get("/ds4/traces")
    async def get_traces(request: Request):
        await auth.require(request.headers.get("authorization"))
        # MVP: return empty list
        return JSONResponse(content={"traces": []})

    return app


_AGENT_REGISTRY: dict = {}


def _register_agents(agents: list) -> None:
    for agent in agents:
        _AGENT_REGISTRY[agent.id] = agent


async def _execute_run(registry, run_id, target_type, target_id, message, stream):
    """Execute a run by calling the real Agno agent and publishing events."""
    import asyncio

    seq = 0

    def _next_seq():
        nonlocal seq
        seq += 1
        return seq

    try:
        await registry.publish(run_id, Ds4AgnoEvent(
            type="run_started",
            run_id=run_id,
            target_type=target_type,
            target_id=target_id,
            seq=_next_seq(),
            content={},
        ).model_dump())

        agent = _AGENT_REGISTRY.get(target_id)
        if not agent:
            await registry.mark_terminal(run_id, "failed")
            await registry.publish(run_id, Ds4AgnoEvent(
                type="run_failed",
                run_id=run_id,
                target_type=target_type,
                target_id=target_id,
                seq=_next_seq(),
                content=f"agent {target_id} not found",
            ).model_dump())
            return

        await registry.publish(run_id, Ds4AgnoEvent(
            type="model_waiting",
            run_id=run_id,
            target_type=target_type,
            target_id=target_id,
            seq=_next_seq(),
            content={},
        ).model_dump())

        await registry.publish(run_id, Ds4AgnoEvent(
            type="model_started",
            run_id=run_id,
            target_type=target_type,
            target_id=target_id,
            seq=_next_seq(),
            content={},
        ).model_dump())

        async for event in agent.arun(
            input=message,
            stream=True,
            stream_events=True,
        ):
            cls_name = type(event).__name__
            content_text = getattr(event, "content", None) or ""
            reasoning_text = getattr(event, "reasoning_content", None) or ""

            if cls_name == "RunContentEvent":
                if content_text:
                    await registry.publish(run_id, Ds4AgnoEvent(
                        type="content_delta",
                        run_id=run_id,
                        target_type=target_type,
                        target_id=target_id,
                        seq=_next_seq(),
                        content=content_text,
                    ).model_dump())
                if reasoning_text:
                    await registry.publish(run_id, Ds4AgnoEvent(
                        type="reasoning_delta",
                        run_id=run_id,
                        target_type=target_type,
                        target_id=target_id,
                        seq=_next_seq(),
                        content=reasoning_text,
                    ).model_dump())

            elif cls_name == "ModelRequestStartedEvent":
                await registry.publish(run_id, Ds4AgnoEvent(
                    type="model_started",
                    run_id=run_id,
                    target_type=target_type,
                    target_id=target_id,
                    seq=_next_seq(),
                    content={},
                ).model_dump())

            elif cls_name == "ModelRequestCompletedEvent":
                tokens = getattr(event, "total_tokens", 0) or 0
                await registry.publish(run_id, Ds4AgnoEvent(
                    type="model_finished",
                    run_id=run_id,
                    target_type=target_type,
                    target_id=target_id,
                    seq=_next_seq(),
                    content={"totalTokens": tokens},
                ).model_dump())

            elif cls_name == "RunCompletedEvent":
                await registry.mark_terminal(run_id, "completed")
                await registry.publish(run_id, Ds4AgnoEvent(
                    type="run_completed",
                    run_id=run_id,
                    target_type=target_type,
                    target_id=target_id,
                    seq=_next_seq(),
                    content=content_text or "",
                ).model_dump())
                return

            elif cls_name == "RunErrorEvent":
                error_content = content_text or "unknown error"
                await registry.mark_terminal(run_id, "failed")
                await registry.publish(run_id, Ds4AgnoEvent(
                    type="run_failed",
                    run_id=run_id,
                    target_type=target_type,
                    target_id=target_id,
                    seq=_next_seq(),
                    content=error_content,
                ).model_dump())
                return

        await registry.mark_terminal(run_id, "completed")
        await registry.publish(run_id, Ds4AgnoEvent(
            type="run_completed",
            run_id=run_id,
            target_type=target_type,
            target_id=target_id,
            seq=_next_seq(),
            content={},
        ).model_dump())

    except asyncio.CancelledError:
        await registry.mark_terminal(run_id, "cancelled")
        await registry.publish(run_id, Ds4AgnoEvent(
            type="run_cancelled",
            run_id=run_id,
            target_type=target_type,
            target_id=target_id,
            seq=_next_seq(),
            content={},
        ).model_dump())
    except Exception as e:
        import traceback
        traceback.print_exc()
        await registry.mark_terminal(run_id, "failed")
        await registry.publish(run_id, Ds4AgnoEvent(
            type="run_failed",
            run_id=run_id,
            target_type=target_type,
            target_id=target_id,
            seq=_next_seq(),
            content=str(e),
        ).model_dump())
