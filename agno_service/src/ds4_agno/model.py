from agno.models.openai.like import OpenAILike
from agno.agent import Agent
from agno.db.sqlite import SqliteDb

def create_ds4_model(settings: "Settings") -> OpenAILike:
    """Create an OpenAILike instance pointing to the DS4 model gateway."""
    base_url = f"{settings.ds4_studio_base_url.rstrip('/')}/api/agno-model/v1"
    return OpenAILike(
        id=settings.ds4_model,
        name="DS4 OpenAI-Compatible",
        api_key=settings.model_gateway_token,
        base_url=base_url,
        timeout=settings.model_timeout_seconds,
        max_retries=0,
    )

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
