"""Database engine and session lifecycle.

Engine and session factory are created lazily and cached, mirroring ``get_settings``.
Importing this module therefore has no side effects: nothing connects, and nothing
requires a valid ``DATABASE_URL`` until something actually asks for a session. That
keeps modules importable in tests that never touch the database.

See ADR-0007 for why persistence is synchronous.
"""

from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from syncaai.config import get_settings


class Base(DeclarativeBase):
    """Declarative base shared by every ORM model."""


@lru_cache
def get_engine() -> Engine:
    """Return the process-wide engine and its connection pool.

    ``pool_pre_ping`` issues a cheap liveness check before handing out a pooled
    connection. Without it, a connection dropped while idle — Postgres restarted,
    an idle timeout, a network blip — is handed to the application and fails on
    use. With it, the dead connection is discarded and replaced transparently, so
    the API recovers on its own instead of erroring until it is restarted.
    """
    return create_engine(get_settings().database_url, pool_pre_ping=True)


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    """Return the configured session factory.

    ``autoflush=False`` keeps SQLAlchemy from emitting writes at surprising moments;
    flushes happen where the code says so. ``expire_on_commit=False`` leaves objects
    usable after a commit, which matters when a response is serialised from an
    instance that was just committed.
    """
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_session() -> Generator[Session, None, None]:
    """Yield a request-scoped session, closed when the request ends.

    One session per request, never a shared global one: a session holds identity map
    state and an open transaction, so sharing it across concurrent requests leaks data
    between them and serialises everything onto one transaction.

    This is a FastAPI dependency rather than a direct import so that tests can
    substitute it — the same seam as ``get_settings``.
    """
    with get_session_factory()() as session:
        yield session
