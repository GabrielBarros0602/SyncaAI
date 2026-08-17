"""Shared fixtures for the API test suite."""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from syncaai.config import Settings, get_settings
from syncaai.main import create_app


@pytest.fixture(autouse=True)
def _isolate_settings() -> Iterator[None]:
    """Clear the cached accessor around every test.

    Only matters for the few tests that construct ``Settings`` themselves or exercise the
    accessor. Anything reaching settings through the application gets them from the
    ``settings`` fixture below, where no cache is involved.
    """
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def settings() -> Settings:
    """The settings the application under test uses.

    Every value is passed explicitly, so the surrounding environment cannot change the
    outcome — CI sets ``APP_ENV=ci``, and a test asserting local behaviour would otherwise
    pass or fail depending on where it ran.

    The object is mutable and the application holds this exact instance, so a test can
    change one value and the next request sees it.
    """
    return Settings(
        database_url="postgresql+psycopg://user:pass@localhost:5432/syncaai_test",
        jwt_secret="a-secret-only-for-tests-long-enough-for-hs256",
        app_env="local",
        log_level="INFO",
        _env_file=None,
    )


@pytest.fixture
def app(settings: Settings) -> FastAPI:
    """A fresh application per test, using the settings fixture and nothing else."""
    return create_app(settings)


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """A client bound to the per-test application."""
    with TestClient(app) as test_client:
        yield test_client
