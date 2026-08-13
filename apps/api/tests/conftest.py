"""Shared fixtures for the API test suite."""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from syncaai.config import get_settings
from syncaai.main import create_app


@pytest.fixture(autouse=True)
def _isolate_settings() -> Iterator[None]:
    """Settings are cached per process; a test that changes the environment must not leak."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def app() -> FastAPI:
    """A fresh application per test, so dependency overrides never leak between tests."""
    return create_app()


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """A client bound to the per-test application."""
    with TestClient(app) as test_client:
        yield test_client
