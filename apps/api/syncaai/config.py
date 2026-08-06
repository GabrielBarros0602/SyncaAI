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

# config.py -> syncaai -> api -> apps -> repository root
ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    """Typed application settings, validated once at startup.

    A missing or malformed value fails here, at boot, with a readable message —
    not later, as an obscure failure on the first database query.
    """

    model_config = SettingsConfigDict(
        env_file=ROOT_ENV,
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
