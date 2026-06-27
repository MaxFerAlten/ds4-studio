from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from ds4_crawl.repository import Repository


def test_repository_uses_compare_and_swap_job_transitions(tmp_path: Path) -> None:
    repository = Repository(tmp_path / "crawl.db")
    repository.create_job("job-1", {"url": "https://example.test"})

    assert repository.transition_job("job-1", "queued", "starting") is True
    assert repository.transition_job("job-1", "queued", "cancelled") is False
    assert repository.get_job("job-1")["state"] == "starting"
    with pytest.raises(ValueError):
        repository.transition_job("job-1", "starting", "succeeded")


def test_migration_preserves_legacy_crawl_cache_transactionally(tmp_path: Path) -> None:
    database = tmp_path / "crawl.db"
    connection = sqlite3.connect(database)
    connection.executescript(
        """
        CREATE TABLE crawl_cache (
            url TEXT NOT NULL,
            opts_hash TEXT NOT NULL,
            payload TEXT NOT NULL,
            fetched_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            last_status INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            etag TEXT,
            last_modified TEXT,
            PRIMARY KEY (url, opts_hash)
        );
        INSERT INTO crawl_cache VALUES (
            'https://example.test', 'opts', '{"markdown":"kept"}',
            1, 2, 200, 'digest', NULL, NULL
        );
        """
    )
    connection.close()

    repository = Repository(database)

    tables = repository.table_names()
    assert {
        "schema_version",
        "jobs",
        "pages",
        "events",
        "sessions",
        "cache",
        "artifacts",
        "artifact_refs",
        "legacy_crawl_cache_backup",
    } <= tables
    backup = repository.connection.execute(
        "SELECT url, payload FROM legacy_crawl_cache_backup"
    ).fetchone()
    assert backup["url"] == "https://example.test"
    assert backup["payload"] == '{"markdown":"kept"}'
