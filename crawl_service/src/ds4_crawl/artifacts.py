from __future__ import annotations

import hashlib
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path


class ArtifactIntegrityError(IOError):
    pass


@dataclass(frozen=True, slots=True)
class ArtifactRecord:
    artifact_id: str
    digest: str
    size_bytes: int
    media_type: str


class ArtifactStore:
    def __init__(self, root: Path | str):
        self.root = Path(root)
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)

    @staticmethod
    def _digest(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    @staticmethod
    def _parse_artifact_id(artifact_id: str) -> str:
        prefix = "sha256:"
        digest = artifact_id[len(prefix) :] if artifact_id.startswith(prefix) else artifact_id
        if len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            raise ValueError("invalid artifact id")
        return digest

    def path_for(self, artifact_id: str) -> Path:
        digest = self._parse_artifact_id(artifact_id)
        return self.root / digest[:2] / digest

    def put(self, data: bytes, media_type: str) -> ArtifactRecord:
        if not isinstance(data, bytes):
            raise TypeError("artifact data must be bytes")
        digest = self._digest(data)
        artifact_id = f"sha256:{digest}"
        target = self.path_for(artifact_id)
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if target.exists():
            self._verify_path(target, digest)
        else:
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{digest}.", dir=target.parent
            )
            temporary = Path(temporary_name)
            try:
                os.fchmod(descriptor, 0o600)
                with os.fdopen(descriptor, "wb") as output:
                    output.write(data)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temporary, target)
                self._fsync_directory(target.parent)
            finally:
                temporary.unlink(missing_ok=True)
        return ArtifactRecord(artifact_id, digest, len(data), media_type)

    def get(self, artifact_id: str) -> bytes:
        digest = self._parse_artifact_id(artifact_id)
        path = self.path_for(artifact_id)
        data = path.read_bytes()
        if self._digest(data) != digest:
            raise ArtifactIntegrityError(f"artifact {artifact_id} failed digest verification")
        return data

    def _verify_path(self, path: Path, digest: str) -> None:
        if self._digest(path.read_bytes()) != digest:
            raise ArtifactIntegrityError(f"artifact sha256:{digest} failed digest verification")

    @staticmethod
    def _fsync_directory(directory: Path) -> None:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        descriptor = os.open(directory, flags)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
