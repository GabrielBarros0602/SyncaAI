"""Shared fixtures for the API test suite."""

import os
import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import OperationalError

from syncaai.config import Settings, discover_env_file, get_settings
from syncaai.main import create_app

API_DIR = Path(__file__).resolve().parents[1]
TEST_DATABASE = "syncaai_test"


class _DatabaseOnly(BaseSettings):
    """``DATABASE_URL`` and nothing else, read as the application reads it. The full settings
    would demand every variable, and a run of unit tests alone needs none of them."""

    model_config = SettingsConfigDict(
        env_file=discover_env_file(), env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str | None = None
    test_database_url: str | None = None


def _test_database_url() -> URL | None:
    """Where the integration tests write: never the development database.

    ``TEST_DATABASE_URL`` when it is set; otherwise the server ``DATABASE_URL`` names, with
    the database swapped for ``syncaai_test``, the name CI already gives its own. A name that
    does not end in ``_test`` is refused, so no variable set by mistake can point the suite at
    a database somebody is using.
    """
    found = _DatabaseOnly()
    if found.test_database_url:
        url = make_url(found.test_database_url)
    elif found.database_url:
        url = make_url(found.database_url).set(database=TEST_DATABASE)
    else:
        return None
    if not re.fullmatch(r"\w+_test", url.database or ""):
        raise pytest.UsageError(f"the test database must be named *_test, not {url.database!r}")
    return url


# Before any test module is imported, so every engine the suite builds reads it: the
# application's settings take the process environment over the .env file. Importing the
# application above already read them once, with the development database, so that copy goes.
_TEST_URL = _test_database_url()
if _TEST_URL is not None:
    os.environ["DATABASE_URL"] = _TEST_URL.render_as_string(hide_password=False)
    get_settings.cache_clear()


@pytest.fixture(scope="session", autouse=True)
def _test_database(request: pytest.FixtureRequest) -> None:
    """Create the test database if it is missing, and migrate it to head, once, before the
    first integration test. A run of unit tests alone touches no database at all.

    Without PostgreSQL the run stops here, saying so, instead of every test waiting on its
    own connection and failing one at a time.
    """
    if not any(item.get_closest_marker("integration") for item in request.session.items):
        return
    if _TEST_URL is None:
        pytest.exit("integration tests need DATABASE_URL or TEST_DATABASE_URL", returncode=1)
    server = create_engine(
        _TEST_URL.set(database="postgres"),
        isolation_level="AUTOCOMMIT",
        connect_args={"connect_timeout": 5},
    )
    try:
        with server.connect() as connection:
            exists = connection.scalar(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": _TEST_URL.database},
            )
            if not exists:
                # The name was held to \w+_test above, so it is safe to quote by hand.
                connection.execute(text(f'CREATE DATABASE "{_TEST_URL.database}"'))
    except OperationalError as error:
        pytest.exit(
            f"PostgreSQL is not reachable at {_TEST_URL.host}:{_TEST_URL.port}; "
            f"start it with `docker compose up -d db` ({error.orig})",
            returncode=1,
        )
    finally:
        server.dispose()
    # No ini file: alembic.ini configures logging, and reconfiguring it here would silence
    # the loggers the tests read.
    migrations = Config()
    migrations.set_main_option("script_location", str(API_DIR / "alembic"))
    command.upgrade(migrations, "head")


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
