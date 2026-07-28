"""Test the agents module."""

from unittest.mock import MagicMock
from ds4_agno.agents import build_default_agent, build_teams, build_workflows
from agno.db.sqlite import SqliteDb
from agno.models.openai.like import OpenAILike

def create_mock_model():
    return OpenAILike(id="test-model", api_key="test-key", base_url="http://127.0.0.1:5173/api/agno-model/v1")

def test_build_default_agent_has_id():
    model = create_mock_model()
    db = MagicMock(spec=SqliteDb)
    agent = build_default_agent(model=model, db=db, tools=[])
    assert agent.id == "ds4-assistant"
    assert agent.name == "DS4 Assistant"

def test_build_default_agent_instructions():
    model = create_mock_model()
    db = MagicMock(spec=SqliteDb)
    agent = build_default_agent(model=model, db=db, tools=[])
    assert any("DS4-Studio" in instr for instr in agent.instructions)
    assert any("text input only" in instr for instr in agent.instructions)
    assert any("OCR" in instr for instr in agent.instructions)
    assert agent.send_media_to_model is False
    assert agent.store_media is False
    assert agent.store_events is True
    assert agent.tool_choice is None

def test_build_teams_empty():
    model = create_mock_model()
    db = MagicMock(spec=SqliteDb)
    teams = build_teams(model=model, db=db, agents=[])
    assert isinstance(teams, list)
    assert len(teams) == 0

def test_build_workflows_empty():
    model = create_mock_model()
    db = MagicMock(spec=SqliteDb)
    workflows = build_workflows(model=model, db=db, agents=[])
    assert isinstance(workflows, list)
    assert len(workflows) == 0
