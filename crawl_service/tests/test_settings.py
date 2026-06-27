from __future__ import annotations

import stat
from pathlib import Path

from ds4_crawl.settings import Settings


def configure_xdg(monkeypatch, root: Path) -> None:
    monkeypatch.setenv("XDG_CONFIG_HOME", str(root / "config"))
    monkeypatch.setenv("XDG_DATA_HOME", str(root / "data"))
    monkeypatch.setenv("XDG_STATE_HOME", str(root / "state"))
    monkeypatch.setenv("XDG_CACHE_HOME", str(root / "cache"))


def test_load_uses_xdg_paths(monkeypatch, tmp_path: Path) -> None:
    configure_xdg(monkeypatch, tmp_path)

    settings = Settings.load()

    assert settings.config_dir == tmp_path / "config" / "ds4-studio" / "crawl"
    assert settings.data_dir == tmp_path / "data" / "ds4-studio" / "crawl"
    assert settings.state_dir == tmp_path / "state" / "ds4-studio" / "crawl"
    assert settings.cache_dir == tmp_path / "cache" / "ds4-studio" / "crawl"
    assert settings.database_path == settings.state_dir / "crawl.db"
    assert settings.artifact_dir == settings.data_dir / "artifacts"
    assert settings.token_path == settings.config_dir / "token"


def test_ensure_token_creates_stable_user_only_secret(monkeypatch, tmp_path: Path) -> None:
    configure_xdg(monkeypatch, tmp_path)
    settings = Settings.load()

    token = settings.ensure_token()

    assert len(token) >= 43
    assert settings.token_path.read_text(encoding="utf-8") == token + "\n"
    assert stat.S_IMODE(settings.token_path.stat().st_mode) == 0o600
    assert settings.ensure_token() == token
