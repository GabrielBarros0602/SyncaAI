"""FastAPI application assembly.

A factory rather than a bare module-level app, so tests can build an isolated
instance and register dependency overrides without leaking state between tests.

Health probes are mounted outside any ``/api/v1`` prefix: they describe the process,
not the product's API, and must not move when the API is versioned.
"""

from fastapi import FastAPI

from syncaai.api.routes import health


def create_app() -> FastAPI:
    """Build and configure the application."""
    app = FastAPI(
        title="SyncaAI",
        version="0.1.0",
        summary="Personal operations dashboard with a calendar-aware AI layer.",
    )
    app.include_router(health.router)
    return app


app = create_app()
