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

REGISTER = "/api/v1/auth/register"
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


def test_registering_returns_the_created_account(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    _wire(app, FakeUsers(), settings)

    response = client.post(
        REGISTER, json={"email": AN_EMAIL, "password": A_PASSWORD, "timezone": "Europe/Lisbon"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == AN_EMAIL
    assert body["timezone"] == "Europe/Lisbon"
    assert "password" not in body
    assert "password_hash" not in body


def test_registering_normalises_the_address(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    """Mixed case and surrounding space must not create a second account."""
    users = FakeUsers()
    _wire(app, users, settings)

    response = client.post(
        REGISTER, json={"email": "  GaBrIeL@Example.COM  ", "password": A_PASSWORD}
    )

    assert response.status_code == 201
    assert response.json()["email"] == AN_EMAIL
    assert users.rows[0].email == AN_EMAIL


def test_registering_an_existing_address_answers_409(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    _wire(app, FakeUsers(_existing()), settings)

    response = client.post(REGISTER, json={"email": AN_EMAIL, "password": A_PASSWORD})

    assert response.status_code == 409


def test_a_malformed_address_is_refused(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    _wire(app, FakeUsers(), settings)

    assert (
        client.post(REGISTER, json={"email": "not-an-email", "password": A_PASSWORD}).status_code
        == 422
    )


def test_a_special_use_domain_is_refused(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    """RFC 2606 reserves .test, .invalid and .localhost. The validator rejects them.

    Worth asserting because it is stricter than a hand-written pattern would be, and
    because it is the kind of behaviour that surprises whoever writes the first fixture.
    """
    _wire(app, FakeUsers(), settings)

    response = client.post(REGISTER, json={"email": "someone@example.test", "password": A_PASSWORD})

    assert response.status_code == 422


def test_a_short_password_is_refused(app: FastAPI, client: TestClient, settings: Settings) -> None:
    _wire(app, FakeUsers(), settings)

    assert client.post(REGISTER, json={"email": AN_EMAIL, "password": "short"}).status_code == 422


def test_an_unknown_time_zone_is_refused(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    """Refused here so no later window calculation raises far from the cause."""
    _wire(app, FakeUsers(), settings)

    response = client.post(
        REGISTER,
        json={"email": AN_EMAIL, "password": A_PASSWORD, "timezone": "Marte/Olympus"},
    )

    assert response.status_code == 422


def test_the_default_time_zone_is_applied(
    app: FastAPI, client: TestClient, settings: Settings
) -> None:
    users = FakeUsers()
    _wire(app, users, settings)

    client.post(REGISTER, json={"email": AN_EMAIL, "password": A_PASSWORD})

    assert users.rows[0].timezone == "America/Sao_Paulo"


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
