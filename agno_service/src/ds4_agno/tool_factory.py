from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Any, Awaitable, Callable
from uuid import uuid4

from agno.run import RunContext
from agno.tools import Function

from .tool_client import Ds4ToolBridgeClient, ToolCatalog
from .tool_context import build_bridge_context
from .tool_errors import Ds4ToolBridgeError


def _safe_error_text(value: object) -> str:
    if not isinstance(value, str):
        return "Tool execution failed."
    return " ".join(value.split())[:512] or "Tool execution failed."


def _model_error(*, code: str, tool_name: str, message: str) -> str:
    safe_code = code if code else "TOOL_EXECUTION_FAILED"
    return (
        f"[DS4_TOOL_ERROR code={safe_code} tool={tool_name}]\n"
        "Tool execution failed. Do not claim success.\n"
        f"{_safe_error_text(message)}"
    )


async def _cancel_bridge_run(
    client: Ds4ToolBridgeClient,
    *,
    run_id: str,
    session_id: str,
) -> None:
    with suppress(Exception):
        await client.cancel(run_id=run_id, session_id=session_id)


async def _execute_ds4_tool(
    *,
    tool_name: str,
    client: Ds4ToolBridgeClient,
    max_history_messages: int,
    max_history_bytes: int,
    run_context: RunContext,
    **arguments: Any,
) -> str:
    try:
        context = build_bridge_context(
            run_context,
            max_messages=max_history_messages,
            max_bytes=max_history_bytes,
        )
        result = await client.execute(
            call_id=f"agno-{uuid4().hex}",
            tool_name=tool_name,
            arguments=arguments,
            context=context,
        )
    except asyncio.CancelledError:
        run_id = getattr(run_context, "run_id", None)
        session_id = getattr(run_context, "session_id", None)
        if isinstance(run_id, str) and isinstance(session_id, str):
            await asyncio.shield(
                _cancel_bridge_run(
                    client,
                    run_id=run_id,
                    session_id=session_id,
                )
            )
        raise
    except Ds4ToolBridgeError as exc:
        return _model_error(
            code=exc.code,
            tool_name=tool_name,
            message=str(exc),
        )

    if result.is_error:
        return _model_error(
            code=result.code or "TOOL_EXECUTION_FAILED",
            tool_name=tool_name,
            message=result.content,
        )
    return result.content


def make_entrypoint(
    *,
    tool_name: str,
    client: Ds4ToolBridgeClient,
    max_history_messages: int,
    max_history_bytes: int,
) -> Callable[..., Awaitable[str]]:
    async def entrypoint(run_context: RunContext, **arguments: Any) -> str:
        return await _execute_ds4_tool(
            tool_name=tool_name,
            client=client,
            max_history_messages=max_history_messages,
            max_history_bytes=max_history_bytes,
            run_context=run_context,
            **arguments,
        )

    entrypoint.__name__ = f"ds4_{tool_name}"
    return entrypoint


def build_ds4_tools(
    *,
    client: Ds4ToolBridgeClient,
    catalog: ToolCatalog,
    max_history_messages: int,
    max_history_bytes: int,
) -> list[Function]:
    result: list[Function] = []
    seen: set[str] = set()
    for entry in catalog.tools:
        function = entry["function"]
        name = function["name"]
        if name in seen:
            raise Ds4ToolBridgeError(
                "INVALID_TOOL_CATALOG",
                "tool catalog contains duplicate names",
            )
        seen.add(name)
        result.append(
            Function(
                name=name,
                description=function["description"],
                parameters=function["parameters"],
                entrypoint=make_entrypoint(
                    tool_name=name,
                    client=client,
                    max_history_messages=max_history_messages,
                    max_history_bytes=max_history_bytes,
                ),
                skip_entrypoint_processing=True,
                show_result=False,
                stop_after_tool_call=False,
            )
        )
    return result
