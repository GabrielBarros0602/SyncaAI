"""Tests for the identity endpoint.

Small surface, one claim that matters: it reports the zone the *server* stores, which is
the only zone that makes the local dates a client sends mean what it thinks they mean.
"""

import uuid
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from syncaai.api.dependencies import get_current_user
from syncaai.db import get_session
from syncaai.models import User

ME = "/api/v1/me"


class _NoOpSession:
    def commit(self) -> None:
        pass


def _a_user(**overrides: object) -> User:
    fields: dict[str, object] = {
        "id": uuid.UUID("11111111-1111-1111-1111-111111111111"),
        "email": "gabriel@example.com",
        "password_hash": "$argon2id$this-should-never-leave-the-database",
        "timezone": "Asia/Tokyo",
        "verified_at": datetime(2026, 8, 1, 12, tzinfo=timezone.utc),
    }
    fields.update(overrides)
    return User(**fields)


def _wire(app: FastAPI, user: User) -> None:
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_session] = lambda: _NoOpSession()


def test_it_reports_the_zone_the_server_stores(app: FastAPI, client: TestClient) -> None:
    """Not the browser's. A client that guessed would ask about a different day than the
    one the answer describes, and nothing would say so."""
    _wire(app, _a_user())

    body = client.get(ME).json()

    assert body["timezone"] == "Asia/Tokyo"


def test_it_carries_only_what_the_client_needs(app: FastAPI, client: TestClient) -> None:
    """Asserted on the whole set rather than on the absence of one field, so a column added
    to `users` cannot arrive here by growing."""
    _wire(app, _a_user())

    body = client.get(ME).json()

    assert set(body) == {"id", "email", "timezone", "verified_at"}


def test_the_password_hash_is_not_in_the_response(app: FastAPI, client: TestClient) -> None:
    """Covered by the test above, and stated on its own because this is the one that would
    matter, and a named test is what survives someone loosening the other."""
    _wire(app, _a_user())

    assert "argon2id" not in client.get(ME).text


def test_an_unverified_account_says_so_rather_than_hiding_it(
    app: FastAPI, client: TestClient
) -> None:
    """Reachable only with a valid token, so the account is the caller's own — there is
    nobody to leak it to."""
    _wire(app, _a_user(verified_at=None))

    assert client.get(ME).json()["verified_at"] is None


def test_it_needs_a_token(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[get_session] = lambda: _NoOpSession()

    response = client.get(ME)

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated."
