"""Tests for the liveness and readiness probes.

Three of these run with no database at all: the session is substituted through the
same dependency seam the application uses. Only the last one needs real Postgres, and
it is marked so it can be deselected locally with ``-m "not integration"``.

This split is the test pyramid from S11 in miniature — fast deterministic tests over
the logic, one narrow integration test over the wiring.
"""

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from syncaai.db import get_session
from syncaai.main import create_app


class _StubSession:
    """Minimal stand-in for a Session; the endpoint only calls ``execute``."""

    def __init__(self, *, fails: bool) -> None:
        self._fails = fails

    def execute(self, *args: Any, **kwargs: Any) -> None:
        if self._fails:
            raise OperationalError("SELECT 1", {}, Exception("connection refused"))


def test_liveness_answers_without_touching_the_database(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


def test_readiness_reports_ready_when_the_query_succeeds(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[get_session] = lambda: _StubSession(fails=False)

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "reachable"}


def test_readiness_reports_unavailable_when_the_query_fails(
    app: FastAPI, client: TestClient
) -> None:
    app.dependency_overrides[get_session] = lambda: _StubSession(fails=True)

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "database": "unreachable"}


@pytest.mark.integration
def test_readiness_against_a_real_database(client: TestClient) -> None:
    """Exercises the real engine, pool and driver against a reachable PostgreSQL."""
    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ready", "database": "reachable"}


def test_interactive_documentation_is_exposed_outside_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "local")

    assert create_app().docs_url == "/docs"


def test_interactive_documentation_is_absent_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("APP_ENV", "production")

    app = create_app()

    assert app.docs_url is None
    assert app.openapi_url is None
