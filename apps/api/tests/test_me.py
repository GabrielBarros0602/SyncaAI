"""Tests for the identity endpoint.

Two claims that matter. It reports the zone the *server* stores, which is the only zone that
makes the local dates a client sends mean what it thinks they mean. And it changes the
usable window only into one the account may have, judged as a pair (ADR-0029).

The window's CHECK, the last of the three guards, is asserted against PostgreSQL in
``test_usable_window.py``.
"""

import uuid
from datetime import datetime, time, timezone

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
        "day_starts_at": time(6),
        "day_ends_at": time(22),
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

    assert set(body) == {"id", "email", "timezone", "verified_at", "day_starts_at", "day_ends_at"}


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


def test_it_reports_the_usable_window(app: FastAPI, client: TestClient) -> None:
    _wire(app, _a_user())

    body = client.get(ME).json()

    assert (body["day_starts_at"], body["day_ends_at"]) == ("06:00:00", "22:00:00")


def test_both_ends_of_the_window_can_be_changed(app: FastAPI, client: TestClient) -> None:
    user = _a_user()
    _wire(app, user)

    response = client.patch(ME, json={"day_starts_at": "08:30", "day_ends_at": "18:00"})

    assert response.status_code == 200, response.text
    assert (user.day_starts_at, user.day_ends_at) == (time(8, 30), time(18))
    assert response.json()["day_starts_at"] == "08:30:00"


def test_one_end_is_judged_against_the_stored_other(app: FastAPI, client: TestClient) -> None:
    """Each end alone is a fine time of day. Only the pair can say that a start of 23:00
    against a stored end of 22:00 is a window that ends before it begins."""
    user = _a_user()
    _wire(app, user)

    response = client.patch(ME, json={"day_starts_at": "23:00"})

    assert response.status_code == 422
    assert (
        response.json()["detail"] == "The usable day has to end after it starts, on the same day."
    )
    assert user.day_starts_at == time(6)


def test_a_window_cannot_cross_midnight(app: FastAPI, client: TestClient) -> None:
    """Not read as running into the next morning, for now (ADR-0029)."""
    _wire(app, _a_user())

    response = client.patch(ME, json={"day_starts_at": "10:00", "day_ends_at": "02:00"})

    assert response.status_code == 422
    assert (
        response.json()["detail"] == "The usable day has to end after it starts, on the same day."
    )


def test_the_shortest_and_longest_windows_are_accepted(app: FastAPI, client: TestClient) -> None:
    """ADR-0023's floor and ceiling, both inclusive."""
    _wire(app, _a_user())

    shortest = client.patch(ME, json={"day_starts_at": "09:00", "day_ends_at": "10:00"})
    longest = client.patch(ME, json={"day_starts_at": "05:00", "day_ends_at": "23:00"})

    assert (shortest.status_code, longest.status_code) == (200, 200)


def test_a_window_under_an_hour_is_refused(app: FastAPI, client: TestClient) -> None:
    _wire(app, _a_user())

    response = client.patch(ME, json={"day_starts_at": "09:00", "day_ends_at": "09:59"})

    assert response.status_code == 422
    assert response.json()["detail"] == "The usable day has to be at least 1 hour long."


def test_a_window_past_eighteen_hours_is_refused(app: FastAPI, client: TestClient) -> None:
    """The ceiling that keeps the load ladder from inverting (ADR-0023)."""
    _wire(app, _a_user())

    response = client.patch(ME, json={"day_starts_at": "05:00", "day_ends_at": "23:01"})

    assert response.status_code == 422
    assert response.json()["detail"] == "The usable day can be at most 18 hours long."


def test_an_explicit_null_is_refused(app: FastAPI, client: TestClient) -> None:
    """Absent already means "leave it". Null would mean "no window", which no account has."""
    _wire(app, _a_user())

    assert client.patch(ME, json={"day_starts_at": None}).status_code == 422


def test_a_time_with_an_offset_is_refused(app: FastAPI, client: TestClient) -> None:
    """A time with an offset names an instant, and a window that repeats every day is not
    one. The account's own zone is what places it."""
    _wire(app, _a_user())

    assert client.patch(ME, json={"day_starts_at": "06:00+01:00"}).status_code == 422


def test_a_time_with_seconds_is_refused(app: FastAPI, client: TestClient) -> None:
    _wire(app, _a_user())

    assert client.patch(ME, json={"day_starts_at": "06:00:30"}).status_code == 422


def test_changing_the_window_needs_a_token(app: FastAPI, client: TestClient) -> None:
    app.dependency_overrides[get_session] = lambda: _NoOpSession()

    assert client.patch(ME, json={"day_starts_at": "08:00"}).status_code == 401
