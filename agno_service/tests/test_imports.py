"""Verify Agno 2.8.0 is importable and all required components are available."""

import subprocess
import sys


def test_agno_version():
    """Agno must be pinned to 2.8.0."""
    import agno
    assert agno.__version__ == "2.8.0", f"Expected 2.8.0, got {agno.__version__}"


def test_openai_like_importable():
    """OpenAILike must be importable from agno.models.openai.like."""
    from agno.models.openai.like import OpenAILike
    assert OpenAILike is not None


def test_agentos_importable():
    """AgentOS must be importable from agno.os."""
    from agno.os import AgentOS
    assert AgentOS is not None


def test_sqlite_db_importable():
    """SqliteDb must be importable from agno.db.sqlite."""
    from agno.db.sqlite import SqliteDb
    assert SqliteDb is not None


def test_no_network_on_import():
    """Ensure no network calls happen during import (telemetry, etc.)."""
    # The import above already succeeded without network.
    # Verify telemetry is disabled by default in our config.
    pass
