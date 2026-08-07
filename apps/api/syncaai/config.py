"""Application configuration.

Values are read from the environment, with the repository-root ``.env`` file as a
fallback for local development. Inside Docker there is no ``.env`` file: compose
injects the same variables into the process environment, and process variables take
precedence over the file, so one class serves both cases without branching.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT_MARKERS = (".git", "docker-compose.yml")


def discover_env_file(start: Path | None = None) -> Path | None:
    """Locate the repository-root ``.env``, or ``None`` when there is none.

    The depth of this module below the repository root is not constant. On a
    developer machine it sits at ``apps/api/syncaai/config.py``, three levels down;
    the container image uses ``apps/api`` as its build context and flattens it to
    ``/app``, leaving only one. A fixed ``parents[n]`` index is therefore wrong in
    one of the two layouts, and raised ``IndexError`` on container start.

    Walking upwards for a repository marker is correct in both. ``None`` is the
    right answer inside the container, where compose supplies the variables through
    the process environment and no ``.env`` file is present.
    """
    origin = (start or Path(__file__)).resolve()
    for directory in origin.parents:
        if any((directory / marker).exists() for marker in _ROOT_MARKERS):
            candidate = directory / ".env"
            return candidate if candidate.is_file() else None
    return None


class Settings(BaseSettings):
    """Typed application settings, validated once at startup.

    A missing or malformed value fails here, at boot, with a readable message —
    not later, as an obscure failure on the first database query.
    """

    model_config = SettingsConfigDict(
        env_file=discover_env_file(),
        env_file_encoding="utf-8",
        # The root .env also carries POSTGRES_* for docker compose interpolation.
        # Those are not settings of this service, so undeclared keys are ignored
        # rather than rejected.
        extra="ignore",
    )

    # No default: the service must refuse to start without a database.
    database_url: str

    app_env: Literal["local", "ci", "production"] = "local"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings instance.

    Cached for two reasons: the environment is read once instead of per request,
    and this function is the single injection seam, so tests override configuration
    in one place instead of mutating global environment variables.
    """
    return Settings()
