from __future__ import annotations

import pytest


class RunCompletedEvent:
    content = "test complete"
    reasoning_content = None


class CompletedTestAgent:
    async def arun(self, **_kwargs):
        yield RunCompletedEvent()


@pytest.fixture
def completed_test_agent():
    return CompletedTestAgent()
