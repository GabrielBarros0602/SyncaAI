"""Tests for settings discovery.

The env-file lookup is covered because a fixed directory index broke container
startup: the image flattens ``apps/api`` into ``/app``, so the module sits at a
different depth than on a developer machine. These tests pin both layouts.
"""

from pathlib import Path

from syncaai.config import discover_env_file


def test_finds_the_env_file_beside_a_repository_marker(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    module = root / "apps" / "api" / "syncaai" / "config.py"
    module.parent.mkdir(parents=True)
    module.touch()
    (root / ".git").mkdir()
    (root / ".env").write_text("APP_ENV=local\n", encoding="utf-8")

    assert discover_env_file(module) == root / ".env"


def test_returns_none_when_the_marker_directory_has_no_env_file(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    module = root / "apps" / "api" / "syncaai" / "config.py"
    module.parent.mkdir(parents=True)
    module.touch()
    (root / "docker-compose.yml").touch()

    assert discover_env_file(module) is None


def test_returns_none_for_the_flattened_container_layout(tmp_path: Path) -> None:
    """No repository marker above /app, so there is nothing to find and no IndexError."""
    module = tmp_path / "app" / "syncaai" / "config.py"
    module.parent.mkdir(parents=True)
    module.touch()

    assert discover_env_file(module) is None
