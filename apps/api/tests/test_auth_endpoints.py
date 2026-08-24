"""Tests for the registration and login endpoints.

The service is real; only the repository and the session are substituted, so validation,
error mapping and token issuing are all exercised without a database.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from syncaai.api.dependencies import limit_login, limit_registration
from syncaai.api.routes.auth import get_auth_service
from syncaai.config import Settings
from syncaai.db import get_session
from syncaai.security.tokens import decode_access_token
from syncaai.services.auth import AuthService
from tests.test_auth_service import (
    A_PASSWORD,
    AN_EMAIL,
    FakeSessions,
    FakeUsers,
    _existing,
)

LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
COOKIE = "syncaai_refresh"


class _NoOpSession:
    def commit(self) -> None:
        pass


def _wire(app: FastAPI, users: FakeUsers, settings: Settings) -> FakeSessions:
    sessions = FakeSessions(users)
    # The limiters need a real session and are exercised on their own; here they would only
    # add a database to tests that are about something else.
    app.dependency_overrides[limit_login] = lambda: None
    app.dependency_overrides[limit_registration] = lambda: None
    app.dependency_overrides[get_session] = lambda: _NoOpSession()
    app.dependency_overrides[get_auth_service] = lambda: AuthService(
        users,  # type: ignore[arg-type]
        sessions,  # type: ignore[arg-type]
        settings,
    )
    return sessions


def test_logging_in_returns_a_usable_access_token(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    existing = _existing()
    _wire(app, FakeUsers(existing), settings)

    response = client.post(LOGIN, json={"email": AN_EMAIL, "password": A_PASSWORD})

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 1800
    assert decode_access_token(body["access_token"], settings) == existing.id


def test_a_wrong_password_answers_401(app: FastAPI, client: TestClient, settings: Settings) -> None:
    _wire(app, FakeUsers(_existing()), settings)

    response = client.post(LOGIN, json={"email": AN_EMAIL, "password": "not the password"})

    assert response.status_code == 401
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_an_unknown_address_answers_401_with_the_same_body(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    """Byte-for-byte identical to a wrong password, so the response reveals nothing."""
    _wire(app, FakeUsers(_existing()), settings)

    unknown = client.post(LOGIN, json={"email": "nobody@example.com", "password": A_PASSWORD})
    wrong = client.post(LOGIN, json={"email": AN_EMAIL, "password": "not the password"})

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


def test_a_web_client_gets_a_cookie_and_no_token_in_the_body(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    """The two channels are exclusive. A body token for a browser would be the whole problem."""
    _wire(app, FakeUsers(_existing()), settings)

    response = client.post(LOGIN, json={"email": AN_EMAIL, "password": A_PASSWORD})

    assert response.status_code == 200
    assert response.json()["refresh_token"] is None
    assert COOKIE in response.cookies

    set_cookie = response.headers["set-cookie"]
    assert "HttpOnly" in set_cookie
    assert "SameSite=strict" in set_cookie
    assert "Path=/api/v1/auth" in set_cookie


def test_a_native_client_gets_the_token_in_the_body_and_no_cookie(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    _wire(app, FakeUsers(_existing()), settings)

    response = client.post(
        LOGIN, json={"email": AN_EMAIL, "password": A_PASSWORD, "client": "native"}
    )

    assert response.json()["refresh_token"]
    assert COOKIE not in response.cookies
    assert "set-cookie" not in response.headers


def test_the_cookie_is_marked_secure_outside_local(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    """Asserted at the production setting, not only at the default.

    ADR-0017 names this as the one place app_env changes a security property, so the flag is
    checked where it matters rather than where the tests happen to run.
    """
    # One mutation on the object the application holds. No environment, no cache, no order
    # to remember.
    settings.app_env = "production"
    _wire(app, FakeUsers(_existing()), settings)

    response = client.post(LOGIN, json={"email": AN_EMAIL, "password": A_PASSWORD})

    assert "Secure" in response.headers["set-cookie"]


def test_the_cookie_is_not_secure_in_local_development(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    _wire(app, FakeUsers(_existing()), settings)

    response = client.post(LOGIN, json={"email": AN_EMAIL, "password": A_PASSWORD})

    assert "Secure" not in response.headers["set-cookie"]


def test_a_web_client_refreshes_from_its_cookie(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    existing = _existing()
    _wire(app, FakeUsers(existing), settings)
    client.post(LOGIN, json={"email": AN_EMAIL, "password": A_PASSWORD})

    response = client.post(REFRESH, json={})

    assert response.status_code == 200
    assert decode_access_token(response.json()["access_token"], settings) == existing.id


def test_a_native_client_refreshes_from_the_body(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    existing = _existing()
    _wire(app, FakeUsers(existing), settings)
    raw = client.post(
        LOGIN, json={"email": AN_EMAIL, "password": A_PASSWORD, "client": "native"}
    ).json()["refresh_token"]

    response = client.post(REFRESH, json={"refresh_token": raw})

    assert response.status_code == 200
    assert decode_access_token(response.json()["access_token"], settings) == existing.id


def test_refreshing_with_no_token_at_all_answers_401(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    _wire(app, FakeUsers(_existing()), settings)

    assert client.post(REFRESH, json={}).status_code == 401


def test_refreshing_with_an_unknown_token_answers_401(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    _wire(app, FakeUsers(_existing()), settings)

    assert client.post(REFRESH, json={"refresh_token": "never issued"}).status_code == 401


def test_a_revoked_session_cannot_mint_an_access_token(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    """The assertion the whole revocable-session decision exists for."""
    _wire(app, FakeUsers(_existing()), settings)
    raw = client.post(
        LOGIN, json={"email": AN_EMAIL, "password": A_PASSWORD, "client": "native"}
    ).json()["refresh_token"]

    assert client.post(LOGOUT, json={"refresh_token": raw}).status_code == 204
    assert client.post(REFRESH, json={"refresh_token": raw}).status_code == 401


def test_logging_out_clears_the_cookie(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    _wire(app, FakeUsers(_existing()), settings)
    client.post(LOGIN, json={"email": AN_EMAIL, "password": A_PASSWORD})

    response = client.post(LOGOUT, json={})

    assert response.status_code == 204
    assert 'syncaai_refresh=""' in response.headers["set-cookie"]


def test_logging_out_with_an_unknown_token_answers_the_same(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    """204 either way, so it does not report whether the token was ever real."""
    _wire(app, FakeUsers(_existing()), settings)

    assert client.post(LOGOUT, json={"refresh_token": "never issued"}).status_code == 204


def test_a_request_with_no_token_is_not_told_its_password_is_wrong(
    app: FastAPI, client: TestClient
) -> None:
    """Both answers are 401 and both are generic. The difference is that one of them is a
    sentence about a form the caller never submitted, and a user whose token expired with
    the tab open would read it as a claim their password is wrong."""
    app.dependency_overrides[get_session] = lambda: _NoOpSession()

    response = client.get("/api/v1/tasks")

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated."


def test_an_unreadable_token_says_the_same_thing(app: FastAPI, client: TestClient) -> None:
    """A forged token and a missing one are the same event as far as the answer goes."""
    app.dependency_overrides[get_session] = lambda: _NoOpSession()

    response = client.get("/api/v1/tasks", headers={"Authorization": "Bearer not-a-token"})

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated."


def test_signing_in_with_the_wrong_password_still_says_so(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    """The sign-in path keeps its own message. It is still one message for a missing
    account and a wrong password, which is what closes enumeration (ADR-0019)."""
    _wire(app, FakeUsers(_existing()), settings)

    response = client.post(LOGIN, json={"email": AN_EMAIL, "password": "not the password"})

    assert response.json()["detail"] == "Incorrect email or password."


def test_an_unknown_address_and_a_wrong_password_are_still_indistinguishable(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    """Guarding the split above: separating the two 401 messages must not have opened a
    channel on the path where it would matter."""
    _wire(app, FakeUsers(_existing()), settings)

    wrong_password = client.post(LOGIN, json={"email": AN_EMAIL, "password": "wrong"})
    unknown_address = client.post(LOGIN, json={"email": "nobody@example.com", "password": "wrong"})

    assert wrong_password.status_code == unknown_address.status_code
    assert wrong_password.json() == unknown_address.json()
