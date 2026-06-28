from __future__ import annotations

import asyncio
from pathlib import Path

from ds4_crawl.artifacts import ArtifactStore
from ds4_crawl.repository import Repository
from ds4_crawl.runner import CrawlRunner
from ds4_crawl.sessions import SessionManager


def test_batch_persists_partial_success_from_real_browser(
    fixture_site: str, tmp_path: Path
) -> None:
    async def scenario() -> None:
        repository = Repository(tmp_path / "crawl.db")
        runner = CrawlRunner(repository, ArtifactStore(tmp_path / "artifacts"))
        repository.create_job(
            "job-partial",
            {"urls": [f"{fixture_site}/ok", f"{fixture_site}/fail"]},
        )
        try:
            await runner.run_job("job-partial")
        finally:
            await runner.close()

        assert repository.get_job("job-partial")["state"] == "partially_succeeded"
        pages = repository.list_pages("job-partial")
        assert [page["state"] for page in pages] == ["succeeded", "failed"]

    asyncio.run(scenario())


def test_slow_job_can_be_cancelled_cooperatively(
    fixture_site: str, tmp_path: Path
) -> None:
    async def scenario() -> None:
        repository = Repository(tmp_path / "crawl.db")
        runner = CrawlRunner(repository, ArtifactStore(tmp_path / "artifacts"))
        repository.create_job("job-slow", {"url": f"{fixture_site}/slow"})
        task = runner.submit("job-slow")
        for _ in range(100):
            if repository.get_job("job-slow")["state"] == "running":
                break
            await asyncio.sleep(0.02)

        await runner.cancel_job("job-slow")
        await task
        assert repository.get_job("job-slow")["state"] == "cancelled"
        await runner.close()

    asyncio.run(scenario())


def test_named_session_close_is_idempotent(tmp_path: Path) -> None:
    repository = Repository(tmp_path / "crawl.db")
    sessions = SessionManager(repository)

    opened = sessions.open("session-1", {"purpose": "test"})

    assert opened["state"] == "open"
    assert sessions.status("session-1")["metadata"] == {"purpose": "test"}
    assert sessions.close("session-1") is True
    assert sessions.close("session-1") is False
