from __future__ import annotations

from pathlib import Path

import pytest

from ds4_crawl.artifacts import ArtifactIntegrityError, ArtifactStore


def test_artifact_store_deduplicates_and_verifies_content(tmp_path: Path) -> None:
    store = ArtifactStore(tmp_path / "artifacts")

    first = store.put(b"crawl-result", media_type="application/octet-stream")
    second = store.put(b"crawl-result", media_type="application/octet-stream")

    assert second == first
    assert store.get(first.artifact_id) == b"crawl-result"
    store.path_for(first.artifact_id).write_bytes(b"corrupt")
    with pytest.raises(ArtifactIntegrityError):
        store.get(first.artifact_id)
