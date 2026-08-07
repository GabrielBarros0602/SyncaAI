"""Shared fixtures for the API test suite."""

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from syncaai.main import create_app


@pytest.fixture
def app() -> FastAPI:
    """A fresh application per test, so dependency overrides never leak between tests."""
    return create_app()


@pytest.fixture
def client(app: FastAPI) -> Iterator[TestClient]:
    """A client bound to the per-test application."""
    with TestClient(app) as test_client:
        yield test_client
