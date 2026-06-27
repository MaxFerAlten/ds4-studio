from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from pathlib import Path


def _xdg_path(variable: str, fallback: Path) -> Path:
    configured = os.environ.get(variable)
    return Path(configured).expanduser() if configured else fallback


@dataclass(frozen=True, slots=True)
class Settings:
    config_dir: Path
    data_dir: Path
    state_dir: Path
    cache_dir: Path
    database_path: Path
    artifact_dir: Path
    token_path: Path

    @classmethod
    def load(cls) -> "Settings":
        home = Path.home()
        suffix = Path("ds4-studio") / "crawl"
        config_dir = _xdg_path("XDG_CONFIG_HOME", home / ".config") / suffix
        data_dir = _xdg_path("XDG_DATA_HOME", home / ".local" / "share") / suffix
        state_dir = _xdg_path("XDG_STATE_HOME", home / ".local" / "state") / suffix
        cache_dir = _xdg_path("XDG_CACHE_HOME", home / ".cache") / suffix
        return cls(
            config_dir=config_dir,
            data_dir=data_dir,
            state_dir=state_dir,
            cache_dir=cache_dir,
            database_path=state_dir / "crawl.db",
            artifact_dir=data_dir / "artifacts",
            token_path=config_dir / "token",
        )

    def ensure_token(self) -> str:
        self.config_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            descriptor = os.open(
                self.token_path,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
            )
        except FileExistsError:
            os.chmod(self.token_path, 0o600)
            token = self.token_path.read_text(encoding="utf-8").strip()
            if len(token) < 43:
                raise ValueError(f"token in {self.token_path} is too short")
            return token

        token = secrets.token_urlsafe(32)
        with os.fdopen(descriptor, "w", encoding="utf-8") as token_file:
            token_file.write(token + "\n")
        return token
