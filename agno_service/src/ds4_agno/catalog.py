from typing import Literal
from pydantic import BaseModel, Field

class CatalogEntry(BaseModel):
    """A catalog entry for an agent, team, or workflow."""
    id: str
    kind: Literal["agent", "team", "workflow"]
    name: str
    description: str = ""
    enabled: bool = True

def get_default_catalog() -> list[CatalogEntry]:
    """Return the default catalog with the ds4-assistant agent."""
    return [
        CatalogEntry(
            id="ds4-assistant",
            kind="agent",
            name="DS4 Assistant",
            description="Default assistant agent for DS4-Studio",
            enabled=True,
        )
    ]
