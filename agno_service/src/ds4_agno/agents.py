from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.models.openai.like import OpenAILike
from agno.tools import Function

def build_default_agent(
    *,
    model: OpenAILike,
    db: SqliteDb,
    tools: list[Function],
) -> Agent:
    """Build a default agent for DS4 Studio integration."""
    return Agent(
        id="ds4-assistant",
        name="DS4 Assistant",
        model=model,
        db=db,
        tools=tools,
        tool_choice="auto" if tools else None,
        tool_call_limit=32,
        instructions=[
            "You are running inside DS4-Studio through Agno AgentOS.",
            "The model accepts text input only.",
            "Images, OCR, audio, video, and file attachments are not supported.",
            "Use only tools explicitly provided in the tool catalog.",
            "Tool execution is delegated to the authoritative DS4 Node runtime.",
            "Never claim a tool succeeded unless its result reports success.",
            "Prefer read, search, and list over bash for file inspection.",
            "Use Sage for symbolic or exact mathematical computation.",
            "Use page_snapshot before page_action.",
            "Do not bypass DS4 filesystem, GitNexus, Sage, browser, or safety guards.",
        ],
        markdown=True,
        add_history_to_context=True,
        num_history_runs=3,
        max_tool_calls_from_history=32,
        add_datetime_to_context=True,
        store_tool_messages=True,
        store_events=True,
        send_media_to_model=False,
        store_media=False,
    )

def build_teams(*, model: OpenAILike, db: SqliteDb, agents: list[Agent]) -> list:
    """Return empty teams list for MVP."""
    return []

def build_workflows(*, model: OpenAILike, db: SqliteDb, agents: list[Agent]) -> list:
    """Return empty workflows list for MVP."""
    return []
