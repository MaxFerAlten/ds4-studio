from typing import Literal
from pydantic import BaseModel, Field

class Ds4AgnoEvent(BaseModel):
    """Canonical event format for DS4-Agno integration.

    All events from the Agno service are normalized into this format.
    """
    type: Literal[
        "run_started",
        "model_waiting",
        "model_started",
        "model_finished",
        "content_delta",
        "reasoning_delta",
        "tool_call",
        "tool_result",
        "step_started",
        "step_completed",
        "run_completed",
        "run_failed",
        "run_cancelled",
        "diagnostic_event",
    ]
    run_id: str
    target_type: Literal["agent", "team", "workflow"]
    target_id: str
    seq: int = Field(default=1)
    ts: str = Field(default_factory=lambda: __import__("datetime").datetime.utcnow().isoformat())
    content: dict | str = Field(default_factory=dict)

    model_config = {"json_schema_extra": {"example": {
        "type": "content_delta",
        "run_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "target_type": "agent",
        "target_id": "ds4-assistant",
        "seq": 2,
        "ts": "2026-07-22T20:00:00.000Z",
        "content": {"text": "Hello"}
    }}}
