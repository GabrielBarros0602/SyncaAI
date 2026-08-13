"""FastAPI application assembly.

A factory rather than a bare module-level app, so tests can build an isolated
instance and register dependency overrides without leaking state between tests.

Health probes are mounted outside any ``/api/v1`` prefix: they describe the process,
not the product's API, and must not move when the API is versioned.
"""

import logging

from fastapi import FastAPI

from syncaai.api.routes import health
from syncaai.config import Settings, get_settings


def configure_logging(level: str) -> None:
    """Apply the configured log level to the root logger."""
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
    )


def create_app() -> FastAPI:
    """Build and configure the application."""
    settings: Settings = get_settings()
    configure_logging(settings.log_level)

    # Interactive documentation describes every endpoint and payload shape. Useful while
    # developing, unnecessary exposure in production, where it is simply absent.
    in_production = settings.app_env == "production"

    app = FastAPI(
        title="SyncaAI",
        version="0.1.0",
        summary="Personal operations dashboard with a calendar-aware AI layer.",
        docs_url=None if in_production else "/docs",
        redoc_url=None if in_production else "/redoc",
        openapi_url=None if in_production else "/openapi.json",
    )
    app.include_router(health.router)
    return app


app = create_app()
