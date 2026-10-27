"""Changing a password while signed in (ADR-0051).

The rules are tested against the service with the repositories faked, where every session's
state can be read directly. The parts only a real request has, the refresh cookie and the
rate limit, are tested over HTTP against PostgreSQL.
"""

import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete

from syncaai.api.dependencies import limit_login
from syncaai.config import Settings
from syncaai.db import get_session_factory
from syncaai.errors import WrongCurrentPasswordError
from syncaai.mail import RecordingMailer
from syncaai.models import RefreshToken, User
from syncaai.security.passwords import hash_password, verify_password
from syncaai.security.refresh import hash_refresh_token
from syncaai.services.password_change import PasswordChangeService
from tests.test_auth_service import A_PASSWORD, AN_EMAIL, FakeSessions, FakeUsers, _existing

A_NEW_PASSWORD = "a brand new password"
CHANGED = "Your SyncaAI password was changed"


@pytest.fixture
def mailer() -> RecordingMailer:
    return RecordingMailer()


def _open(sessions: FakeSessions, user: User, raw: str, **state: object) -> RefreshToken:
    session = RefreshToken(
        user_id=user.id,
        token_hash=hash_refresh_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    sessions.add(session)
    for name, value in state.items():
        setattr(session, name, value)
    return session


def _people(*users: User) -> tuple[FakeUsers, FakeSessions]:
    people = FakeUsers()
    for user in users:
        people.add(user)
    return people, FakeSessions(people)


def _service(
    users: FakeUsers, sessions: FakeSessions, mailer: RecordingMailer
) -> PasswordChangeService:
    return PasswordChangeService(users, sessions, mailer)  # type: ignore[arg-type]


# --- The rules ------------------------------------------------------------------------------


def test_a_change_keeps_this_session_and_ends_every_other(mailer: RecordingMailer) -> None:
    user = _existing()
    users, sessions = _people(user)
    here, there = _open(sessions, user, "here"), _open(sessions, user, "there")

    _service(users, sessions, mailer).change(
        user.id, A_PASSWORD, A_NEW_PASSWORD, this_session="here"
    )

    assert verify_password(A_NEW_PASSWORD, user.password_hash)
    assert (here.revoked_at, there.revoked_at is not None) == (None, True)
    told = mailer.to(AN_EMAIL)
    assert [message.subject for message in told] == [CHANGED]
    # No link: the real message has none, which is what makes an imitation easy to spot.
    assert "http" not in told[0].text


def test_a_wrong_current_password_changes_nothing(mailer: RecordingMailer) -> None:
    user = _existing()
    users, sessions = _people(user)
    there = _open(sessions, user, "there")

    with pytest.raises(WrongCurrentPasswordError):
        _service(users, sessions, mailer).change(
            user.id, "not the password", A_NEW_PASSWORD, this_session="here"
        )

    assert verify_password(A_PASSWORD, user.password_hash)
    assert there.revoked_at is None
    assert mailer.to(AN_EMAIL) == []


def test_with_no_session_named_every_session_ends(mailer: RecordingMailer) -> None:
    """More than meant, never fewer."""
    user = _existing()
    users, sessions = _people(user)
    opened = [_open(sessions, user, "here"), _open(sessions, user, "there")]

    _service(users, sessions, mailer).change(user.id, A_PASSWORD, A_NEW_PASSWORD, this_session=None)

    assert all(session.revoked_at is not None for session in opened)


@pytest.mark.parametrize("named", ["revoked", "expired", "unknown"])
def test_a_session_that_is_not_live_is_not_kept(mailer: RecordingMailer, named: str) -> None:
    user = _existing()
    users, sessions = _people(user)
    long_ago = datetime.now(timezone.utc) - timedelta(days=1)
    _open(sessions, user, "revoked", revoked_at=long_ago)
    _open(sessions, user, "expired", expires_at=long_ago)
    live = _open(sessions, user, "live")

    _service(users, sessions, mailer).change(
        user.id, A_PASSWORD, A_NEW_PASSWORD, this_session=named
    )

    assert live.revoked_at is not None


def test_somebody_else_s_session_is_neither_kept_nor_ended(mailer: RecordingMailer) -> None:
    user, other = _existing(), _existing("somebody@example.com")
    users, sessions = _people(user, other)
    mine = _open(sessions, user, "mine")
    theirs = _open(sessions, other, "theirs")

    _service(users, sessions, mailer).change(
        user.id, A_PASSWORD, A_NEW_PASSWORD, this_session="theirs"
    )

    assert (mine.revoked_at is not None, theirs.revoked_at) == (True, None)


# --- Over HTTP ------------------------------------------------------------------------------

CHANGE = "/api/v1/auth/change-password"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"


@pytest.fixture
def person() -> Iterator[str]:
    """A confirmed account, so it can sign in."""
    email = f"change-{uuid.uuid4()}@example.com"
    with get_session_factory()() as session:
        session.add(
            User(
                email=email,
                password_hash=hash_password(A_PASSWORD),
                verified_at=datetime.now(timezone.utc),
            )
        )
        session.commit()
    try:
        yield email
    finally:
        with get_session_factory()() as session:
            session.execute(delete(User).where(User.email == email))
            session.commit()


@pytest.fixture
def signed_in(app: FastAPI, client: TestClient, person: str) -> tuple[str, str]:
    """This browser, signed in with a cookie, and another device holding a native token.
    Returns the browser's access token and the device's refresh token."""
    # The login limit counts every sign-in in the hour; these tests are not about it.
    app.dependency_overrides[limit_login] = lambda: None
    browser = client.post(LOGIN, json={"email": person, "password": A_PASSWORD})
    device = client.post(LOGIN, json={"email": person, "password": A_PASSWORD, "client": "native"})
    assert browser.status_code == device.status_code == 200
    return browser.json()["access_token"], device.json()["refresh_token"]


def _bearer(access: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {access}"}


@pytest.mark.integration
def test_changing_the_password_keeps_this_browser_and_signs_the_other_device_out(
    client: TestClient, person: str, signed_in: tuple[str, str]
) -> None:
    access, device = signed_in

    response = client.post(
        CHANGE,
        json={"current_password": A_PASSWORD, "new_password": A_NEW_PASSWORD},
        headers=_bearer(access),
    )

    assert response.status_code == 204, response.text
    assert client.post(REFRESH).status_code == 200
    assert client.post(REFRESH, json={"refresh_token": device}).status_code == 401
    assert client.post(LOGIN, json={"email": person, "password": A_PASSWORD}).status_code == 401
    assert client.post(LOGIN, json={"email": person, "password": A_NEW_PASSWORD}).status_code == 200


@pytest.mark.integration
def test_a_native_client_keeps_the_session_it_names(
    app: FastAPI, settings: Settings, person: str
) -> None:
    app.dependency_overrides[limit_login] = lambda: None
    with TestClient(app) as native:
        tokens = [
            native.post(
                LOGIN, json={"email": person, "password": A_PASSWORD, "client": "native"}
            ).json()
            for _ in range(2)
        ]
        kept, other = (token["refresh_token"] for token in tokens)

        response = native.post(
            CHANGE,
            json={
                "current_password": A_PASSWORD,
                "new_password": A_NEW_PASSWORD,
                "refresh_token": kept,
            },
            headers=_bearer(tokens[0]["access_token"]),
        )

        assert response.status_code == 204, response.text
        assert native.post(REFRESH, json={"refresh_token": kept}).status_code == 200
        assert native.post(REFRESH, json={"refresh_token": other}).status_code == 401


@pytest.mark.integration
def test_a_wrong_current_password_is_a_field_error_that_signs_nobody_out(
    client: TestClient, signed_in: tuple[str, str]
) -> None:
    """Not 401: the web client answers a 401 by renewing the session and then signing out."""
    access, device = signed_in

    response = client.post(
        CHANGE,
        json={"current_password": "not the password", "new_password": A_NEW_PASSWORD},
        headers=_bearer(access),
    )

    assert (response.status_code, response.json()) == (
        422,
        {"detail": "That is not your current password."},
    )
    assert client.post(REFRESH).status_code == 200
    assert client.post(REFRESH, json={"refresh_token": device}).status_code == 200


@pytest.mark.integration
def test_guessing_the_current_password_is_limited_like_signing_in(
    client: TestClient, settings: Settings, signed_in: tuple[str, str]
) -> None:
    access, _ = signed_in
    settings.login_attempts_per_hour = 2
    guess = {"current_password": "a guess", "new_password": A_NEW_PASSWORD}

    answers = [client.post(CHANGE, json=guess, headers=_bearer(access)) for _ in range(3)]

    assert [answer.status_code for answer in answers] == [422, 422, 429]
    assert int(answers[-1].headers["Retry-After"]) > 0


@pytest.mark.integration
def test_changing_the_password_needs_a_session(client: TestClient) -> None:
    response = client.post(
        CHANGE, json={"current_password": A_PASSWORD, "new_password": A_NEW_PASSWORD}
    )

    assert response.status_code == 401


@pytest.mark.integration
def test_the_new_password_is_held_to_registration_s_rules(
    client: TestClient, signed_in: tuple[str, str]
) -> None:
    access, _ = signed_in

    response = client.post(
        CHANGE,
        json={"current_password": A_PASSWORD, "new_password": "short"},
        headers=_bearer(access),
    )

    assert response.status_code == 422
