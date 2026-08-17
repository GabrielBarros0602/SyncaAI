"""FastAPI application assembly.

A factory rather than a bare module-level app, so tests can build an isolated
instance and register dependency overrides without leaking state between tests.

Health probes are mounted outside any ``/api/v1`` prefix: they describe the process,
not the product's API, and must not move when the API is versioned.
"""

import logging

from fastapi import FastAPI

from syncaai.api import v1
from syncaai.api.errors import register_error_handlers
from syncaai.api.routes import health
from syncaai.config import Settings, get_settings


def configure_logging(level: str) -> None:
    """Apply the configured log level to the root logger."""
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build and configure the application.

    Passing settings explicitly makes the application use exactly those, for the decisions
    taken here at construction *and* for everything read per request. Without it a test can
    only influence settings through the environment, and the accessor is cached, so a change
    made after the first read is silently ignored — which produces a test that passes while
    asserting the wrong thing.
    """
    explicit = settings is not None
    settings = settings or get_settings()
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
    register_error_handlers(app)
    if explicit:
        app.dependency_overrides[get_settings] = lambda: settings

    app.include_router(health.router)
    app.include_router(v1.router)
    return app


app = create_app()
