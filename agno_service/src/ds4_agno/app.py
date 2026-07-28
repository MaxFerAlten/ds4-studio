"""FastAPI application for Agno AgentOS sidecar with full DS4 integration."""

import asyncio
from contextlib import asynccontextmanager
import json
import os
from typing import Callable, Optional
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from ds4_agno.auth import ServiceAuthenticator
from ds4_agno.settings import Settings
from ds4_agno.db import create_db
from ds4_agno.catalog import get_default_catalog
from ds4_agno.agents import build_default_agent, build_teams, build_workflows
from ds4_agno.events import Ds4AgnoEvent
from ds4_agno.run_registry import RunRegistry
from ds4_agno.model import create_ds4_model
from ds4_agno.tool_client import (
    Ds4ToolBridgeClient,
    ToolCatalog,
    get_catalog_sync,
)
from ds4_agno.tool_errors import Ds4ToolBridgeError
from ds4_agno.tool_factory import build_ds4_tools
from ds4_agno.text_only import (
    RejectAgentOsMediaMiddleware,
    TextOnlyInputGuard,
)


def create_app(
    settings: Optional[Settings] = None,
    *,
    catalog_fetcher: Callable[..., ToolCatalog] = get_catalog_sync,
    tool_client_factory: Callable[..., Ds4ToolBridgeClient] = (
        Ds4ToolBridgeClient
    ),
) -> FastAPI:
    """Factory: create a FastAPI app with full AgentOS integration.

    If settings is None, loads from environment variables.
    """
    _settings = settings or Settings()
    auth = ServiceAuthenticator(expected_token=_settings.service_token)
    db = create_db(_settings)
    model = create_ds4_model(_settings)
    tool_catalog: ToolCatalog | None = None
    tool_client: Ds4ToolBridgeClient | None = None
    tools = []
    if _settings.tools_enabled:
        tool_catalog = catalog_fetcher(
            base_url=_settings.tool_bridge_base_url,
            token=_settings.tool_bridge_token,
            timeout_seconds=min(
                _settings.tool_request_timeout_seconds,
                5.0,
            ),
        )
        if tool_catalog.profile != _settings.tool_profile:
            raise Ds4ToolBridgeError(
                "INVALID_TOOL_CATALOG",
                "tool catalog profile does not match configured profile",
            )
        if _settings.tool_profile == "full" and len(tool_catalog.tools) != 16:
            raise Ds4ToolBridgeError(
                "INVALID_TOOL_CATALOG",
                "full tool catalog must contain exactly 16 tools",
            )
        tool_client = tool_client_factory(
            base_url=_settings.tool_bridge_base_url,
            token=_settings.tool_bridge_token,
            timeout_seconds=_settings.tool_request_timeout_seconds,
        )
        tools = build_ds4_tools(
            client=tool_client,
            catalog=tool_catalog,
            max_history_messages=_settings.tool_max_history_messages,
            max_history_bytes=_settings.tool_max_history_bytes,
        )
    agents_list = [
        build_default_agent(model=model, db=db, tools=tools)
    ]
    teams_list = build_teams(model=model, db=db, agents=agents_list)
    workflows_list = build_workflows(model=model, db=db, agents=agents_list)
    registry = RunRegistry()
    agent_registry = {agent.id: agent for agent in agents_list}

    @asynccontextmanager
    async def ds4_lifespan(_app: FastAPI):
        try:
            yield
        finally:
            await registry.shutdown()
            if tool_client is not None:
                await tool_client.aclose()

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
        cors_allowed_origins=_settings.cors_allowed_origins,
        lifespan=ds4_lifespan,
        on_route_conflict="error",
    )

    app = agent_os.get_app()
    app.add_middleware(RejectAgentOsMediaMiddleware)
    app.state.ds4_settings = _settings
    app.state.ds4_run_registry = registry
    app.state.ds4_tool_client = tool_client
    app.state.ds4_tool_catalog = tool_catalog
    app.state.ds4_tools = tools
    app.state.ds4_agents = agents_list
    app.state.ds4_agent_registry = agent_registry

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
            "capabilities": {
                "tools": bool(tools),
                "toolProfile": (
                    tool_catalog.profile if tool_catalog is not None else None
                ),
                "toolCount": len(tools),
                "media": False,
                "ocr": False,
            },
        }

    @app.get("/ds4/catalog")
    async def catalog(_request: Request):
        await auth.require(_request.headers.get("authorization"))
        catalog_items = get_default_catalog()
        return {
            "agents": [c.model_dump() for c in catalog_items if c.kind == "agent"],
            "teams": [c.model_dump() for c in catalog_items if c.kind == "team"],
            "workflows": [c.model_dump() for c in catalog_items if c.kind == "workflow"],
            "capabilities": {
                "tools": bool(tools),
                "toolProfile": (
                    tool_catalog.profile if tool_catalog is not None else None
                ),
                "toolCount": len(tools),
                "toolNames": [tool.name for tool in tools],
                "catalogDigest": (
                    tool_catalog.catalog_digest
                    if tool_catalog is not None
                    else None
                ),
                "media": False,
                "ocr": False,
            },
        }

    @app.post("/ds4/runs")
    async def create_run(request: Request):
        await auth.require(request.headers.get("authorization"))
        try:
            body = await request.json()
            message = TextOnlyInputGuard.validate_ds4_payload(body)
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            return JSONResponse(
                status_code=422,
                content={
                    "error": TextOnlyInputGuard.ERROR_CODE,
                    "message": str(exc),
                },
            )
        target_type = body.get("targetType", "agent")
        target_id = body.get("targetId", "ds4-assistant")
        stream = body.get("stream", True)
        session_id = body.get("sessionId") or f"session-{uuid4().hex}"

        # Validate target exists in catalog
        catalog_items = get_default_catalog()
        found = any(c.id == target_id and c.kind == target_type for c in catalog_items)
        if not found:
            return JSONResponse(
                status_code=422,
                content={"error": f"target {target_type}/{target_id} not in catalog"},
            )

        run_id = await registry.create_run(target_type, target_id)
        coro = _execute_run(
            registry,
            agent_registry,
            run_id,
            target_type,
            target_id,
            message,
            stream,
            session_id,
        )
        await registry.start_task(run_id, coro)

        return JSONResponse(
            status_code=202,
            content={
                "runId": run_id,
                "sessionId": session_id,
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

async def _execute_run(
    registry,
    agent_registry,
    run_id,
    target_type,
    target_id,
    message,
    stream,
    session_id,
):
    """Execute a run by calling the real Agno agent and publishing events."""
    import asyncio

    seq = 0
    event_stream = None

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

        agent = agent_registry.get(target_id)
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

        terminal_seen = False

        # Drain agent.arun() to natural completion (StopAsyncIteration) rather than
        # returning early: abandoning the generator mid-stream sends it a GeneratorExit,
        # which Agno's own run loop treats as a client disconnect and persists as
        # RunStatus.cancelled even though the run actually completed successfully.
        event_stream = agent.arun(
            input=message,
            stream=True,
            stream_events=True,
            session_id=session_id,
            run_id=run_id,
        )
        async for event in event_stream:
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

            elif cls_name == "ToolCallStartedEvent":
                tool = getattr(event, "tool", None)
                await registry.publish(run_id, Ds4AgnoEvent(
                    type="tool_call",
                    run_id=run_id,
                    target_type=target_type,
                    target_id=target_id,
                    seq=_next_seq(),
                    content={
                        "toolCallId": getattr(tool, "tool_call_id", None),
                        "toolName": getattr(tool, "tool_name", None),
                    },
                ).model_dump())

            elif cls_name in ("ToolCallCompletedEvent", "ToolCallErrorEvent"):
                tool = getattr(event, "tool", None)
                error = getattr(event, "error", None)
                await registry.publish(run_id, Ds4AgnoEvent(
                    type="tool_result",
                    run_id=run_id,
                    target_type=target_type,
                    target_id=target_id,
                    seq=_next_seq(),
                    content={
                        "toolCallId": getattr(tool, "tool_call_id", None),
                        "toolName": getattr(tool, "tool_name", None),
                        "isError": (
                            cls_name == "ToolCallErrorEvent"
                            or bool(getattr(tool, "tool_call_error", False))
                        ),
                        "result": (
                            error
                            if error is not None
                            else getattr(tool, "result", None)
                        ),
                    },
                ).model_dump())

            elif cls_name == "RunCompletedEvent":
                terminal_seen = True
                await registry.mark_terminal(run_id, "completed")
                await registry.publish(run_id, Ds4AgnoEvent(
                    type="run_completed",
                    run_id=run_id,
                    target_type=target_type,
                    target_id=target_id,
                    seq=_next_seq(),
                    content=content_text or "",
                ).model_dump())

            elif cls_name == "RunErrorEvent":
                terminal_seen = True
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

        if not terminal_seen:
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
        if event_stream is not None:
            await event_stream.aclose()
        await registry.mark_terminal(run_id, "cancelled")
        await registry.publish(run_id, Ds4AgnoEvent(
            type="run_cancelled",
            run_id=run_id,
            target_type=target_type,
            target_id=target_id,
            seq=_next_seq(),
            content={},
        ).model_dump())
        raise
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
