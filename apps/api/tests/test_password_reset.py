"""Tests for setting a new password without knowing the old one.

This is the path that would reopen the leak S3 closed: it asks the same question
registration asks, in a different shape. So the first assertion here is the same assertion
as there — the two answers are identical.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from syncaai.api.dependencies import limit_password_reset
from syncaai.api.routes.auth import get_password_reset_service
from syncaai.config import Settings
from syncaai.db import get_session
from syncaai.errors import InvalidLinkTokenError
from syncaai.mail import RecordingMailer
from syncaai.models import PasswordResetToken, RefreshToken
from syncaai.security.opaque import hash_token
from syncaai.security.passwords import verify_password
from syncaai.services.password_reset import PasswordResetService
from tests.test_auth_service import A_PASSWORD, AN_EMAIL, FakeSessions, FakeUsers, _existing

FORGOT = "/api/v1/auth/forgot-password"
A_NEW_PASSWORD = "a brand new password"


class FakeResetTokens:
    def __init__(self, users: FakeUsers) -> None:
        self._users = users
        self.rows: list[PasswordResetToken] = []

    def get_by_hash(self, token_hash: str) -> PasswordResetToken | None:
        return next((row for row in self.rows if row.token_hash == token_hash), None)

    def add(self, token: PasswordResetToken) -> None:
        token.id = uuid.uuid4()
        token.user = next(user for user in self._users.rows if user.id == token.user_id)
        self.rows.append(token)


class _NoOpSession:
    def commit(self) -> None:
        pass


@pytest.fixture
def mailer() -> RecordingMailer:
    return RecordingMailer()


def _service(
    users: FakeUsers, mailer: RecordingMailer, settings: Settings
) -> tuple[PasswordResetService, FakeResetTokens, FakeSessions]:
    tokens, sessions = FakeResetTokens(users), FakeSessions(users)
    service = PasswordResetService(users, tokens, sessions, mailer, settings)  # type: ignore[arg-type]
    return service, tokens, sessions


def _take_link(mailer: RecordingMailer, to: str) -> str:
    return mailer.to(to)[0].text.split("/reset?token=")[1].split("\n")[0].strip()


def test_a_known_and_an_unknown_address_get_identical_responses(
    app: FastAPI, client: TestClient, settings: Settings, mailer: RecordingMailer
) -> None:
    """Same assertion as registration, because it is the same question in another shape."""
    users = FakeUsers(_existing())
    service, _, _ = _service(users, mailer, settings)
    app.dependency_overrides[limit_password_reset] = lambda: None
    app.dependency_overrides[get_session] = lambda: _NoOpSession()
    app.dependency_overrides[get_password_reset_service] = lambda: service

    known = client.post(FORGOT, json={"email": AN_EMAIL})
    unknown = client.post(FORGOT, json={"email": "nobody@example.com"})

    assert known.status_code == unknown.status_code == 202
    assert known.content == unknown.content


def test_nothing_is_mailed_to_an_address_without_an_account(
    settings: Settings, mailer: RecordingMailer
) -> None:
    """Not only about disclosure: mailing a stranger on demand is a worse problem."""
    service, _, _ = _service(FakeUsers(), mailer, settings)

    service.request("nobody@example.com")

    assert mailer.sent == []


def test_nothing_is_mailed_to_an_unverified_account(
    settings: Settings, mailer: RecordingMailer
) -> None:
    """Resetting would not let them in anyway — they need to confirm the address first."""
    service, _, _ = _service(FakeUsers(_existing(verified=False)), mailer, settings)

    service.request(AN_EMAIL)

    assert mailer.sent == []


def test_a_verified_account_receives_a_link(settings: Settings, mailer: RecordingMailer) -> None:
    service, tokens, _ = _service(FakeUsers(_existing()), mailer, settings)

    service.request(AN_EMAIL)

    assert "/reset?token=" in mailer.to(AN_EMAIL)[0].text
    assert tokens.rows[0].token_hash == hash_token(_take_link(mailer, AN_EMAIL))


def test_resetting_changes_the_password(settings: Settings, mailer: RecordingMailer) -> None:
    user = _existing()
    service, _, _ = _service(FakeUsers(user), mailer, settings)
    service.request(AN_EMAIL)

    service.reset(_take_link(mailer, AN_EMAIL), A_NEW_PASSWORD)

    assert verify_password(A_NEW_PASSWORD, user.password_hash)
    assert not verify_password(A_PASSWORD, user.password_hash)


def test_resetting_signs_every_device_out(settings: Settings, mailer: RecordingMailer) -> None:
    """The part that is easy to leave out and makes the rest pointless."""
    user = _existing()
    users = FakeUsers(user)
    service, _, sessions = _service(users, mailer, settings)
    sessions.add(
        RefreshToken(
            user_id=user.id,
            token_hash="whatever",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
    )
    service.request(AN_EMAIL)

    service.reset(_take_link(mailer, AN_EMAIL), A_NEW_PASSWORD)

    assert sessions.rows[0].revoked_at is not None


def test_a_reset_token_works_only_once(settings: Settings, mailer: RecordingMailer) -> None:
    service, _, _ = _service(FakeUsers(_existing()), mailer, settings)
    service.request(AN_EMAIL)
    raw = _take_link(mailer, AN_EMAIL)
    service.reset(raw, A_NEW_PASSWORD)

    with pytest.raises(InvalidLinkTokenError):
        service.reset(raw, "yet another password")


def test_an_expired_reset_token_is_refused(settings: Settings, mailer: RecordingMailer) -> None:
    service, tokens, _ = _service(FakeUsers(_existing()), mailer, settings)
    service.request(AN_EMAIL)
    tokens.rows[0].expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    with pytest.raises(InvalidLinkTokenError):
        service.reset(_take_link(mailer, AN_EMAIL), A_NEW_PASSWORD)


def test_an_unknown_reset_token_is_refused(settings: Settings, mailer: RecordingMailer) -> None:
    service, _, _ = _service(FakeUsers(_existing()), mailer, settings)

    with pytest.raises(InvalidLinkTokenError):
        service.reset("never issued", A_NEW_PASSWORD)


def test_the_reset_response_does_not_talk_about_signing_up(
    app: FastAPI, client: TestClient, settings: Settings, mailer: RecordingMailer
) -> None:
    """It used to. Somebody asking to reset a password was told to finish registering."""
    users = FakeUsers(_existing())
    service, _, _ = _service(users, mailer, settings)
    app.dependency_overrides[limit_password_reset] = lambda: None
    app.dependency_overrides[get_session] = lambda: _NoOpSession()
    app.dependency_overrides[get_password_reset_service] = lambda: service

    detail = client.post(FORGOT, json={"email": AN_EMAIL}).json()["detail"]

    assert "password" in detail
    assert "signing up" not in detail
