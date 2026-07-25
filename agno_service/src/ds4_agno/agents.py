from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.models.openai.like import OpenAILike

def build_default_agent(*, model: OpenAILike, db: SqliteDb) -> Agent:
    """Build a default agent for DS4 Studio integration."""
    return Agent(
        id="ds4-assistant",
        name="DS4 Assistant",
        model=model,
        db=db,
        instructions=[
            "You are running inside DS4-Studio through Agno AgentOS.",
            "Do not claim access to tools that are not explicitly registered.",
            "Do not delegate privileged filesystem or shell actions.",
        ],
        markdown=True,
        add_history_to_context=True,
        num_history_runs=3,
        add_datetime_to_context=True,
    )

def build_teams(*, model: OpenAILike, db: SqliteDb, agents: list[Agent]) -> list:
    """Return empty teams list for MVP."""
    return []

def build_workflows(*, model: OpenAILike, db: SqliteDb, agents: list[Agent]) -> list:
    """Return empty workflows list for MVP."""
    return []
