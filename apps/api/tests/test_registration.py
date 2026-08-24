"""Tests for opening an account and proving the address behind it.

The first test is the one the whole sprint exists for. Everything else supports it.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from syncaai.api.dependencies import limit_registration
from syncaai.api.routes.auth import get_registration_service
from syncaai.config import Settings
from syncaai.db import get_session
from syncaai.errors import InvalidLinkTokenError
from syncaai.mail import RecordingMailer
from syncaai.models import VerificationToken
from syncaai.security.opaque import hash_token
from syncaai.services.registration import RegistrationService
from tests.test_auth_service import A_PASSWORD, AN_EMAIL, FakeUsers, _existing

REGISTER = "/api/v1/auth/register"
VERIFY = "/api/v1/auth/verify"


class FakeTokens:
    def __init__(self, users: FakeUsers) -> None:
        self._users = users
        self.rows: list[VerificationToken] = []

    def get_by_hash(self, token_hash: str) -> VerificationToken | None:
        return next((row for row in self.rows if row.token_hash == token_hash), None)

    def add(self, token: VerificationToken) -> None:
        token.id = uuid.uuid4()
        token.user = next(user for user in self._users.rows if user.id == token.user_id)
        self.rows.append(token)


class _NoOpSession:
    def commit(self) -> None:
        pass


def _service(users: FakeUsers, mailer: RecordingMailer, settings: Settings) -> RegistrationService:
    return RegistrationService(users, FakeTokens(users), mailer, settings)  # type: ignore[arg-type]


def _wire(
    app: FastAPI, users: FakeUsers, mailer: RecordingMailer, settings: Settings
) -> RegistrationService:
    service = _service(users, mailer, settings)
    app.dependency_overrides[limit_registration] = lambda: None
    app.dependency_overrides[get_session] = lambda: _NoOpSession()
    app.dependency_overrides[get_registration_service] = lambda: service
    return service


@pytest.fixture
def mailer() -> RecordingMailer:
    return RecordingMailer()


def test_a_new_and_an_existing_address_get_identical_responses(
    app: FastAPI, client: TestClient, settings: Settings, mailer: RecordingMailer
) -> None:
    """The assertion the sprint exists for.

    Same status, same headers that matter, same body — byte for byte. If these ever differ,
    registration is an oracle for which addresses are registered again.
    """
    _wire(app, FakeUsers(_existing()), mailer, settings)

    existing = client.post(REGISTER, json={"email": AN_EMAIL, "password": A_PASSWORD})
    new = client.post(REGISTER, json={"email": "nobody@example.com", "password": A_PASSWORD})

    assert existing.status_code == new.status_code == 202
    assert existing.content == new.content


def test_the_difference_is_only_in_which_message_was_sent(
    app: FastAPI, client: TestClient, settings: Settings, mailer: RecordingMailer
) -> None:
    """What the response hides, the mailbox reveals — to its owner, and to nobody else."""
    _wire(app, FakeUsers(_existing()), mailer, settings)

    client.post(REGISTER, json={"email": AN_EMAIL, "password": A_PASSWORD})
    client.post(REGISTER, json={"email": "nobody@example.com", "password": A_PASSWORD})

    to_existing = mailer.to(AN_EMAIL)[0]
    to_new = mailer.to("nobody@example.com")[0]

    assert "already has one" in to_existing.text
    assert "Confirm it here" in to_new.text
    assert "/verify?token=" in to_new.text


def test_registering_a_new_address_creates_an_unverified_account(
    app: FastAPI, client: TestClient, settings: Settings, mailer: RecordingMailer
) -> None:
    users = FakeUsers()
    _wire(app, users, mailer, settings)

    client.post(REGISTER, json={"email": AN_EMAIL, "password": A_PASSWORD})

    assert users.rows[0].verified_at is None


def test_registering_normalises_the_address(
    app: FastAPI, client: TestClient, settings: Settings, mailer: RecordingMailer
) -> None:
    users = FakeUsers()
    _wire(app, users, mailer, settings)

    client.post(REGISTER, json={"email": "  GaBrIeL@Example.COM  ", "password": A_PASSWORD})

    assert users.rows[0].email == AN_EMAIL


def test_a_malformed_address_is_refused(
    app: FastAPI, client: TestClient, settings: Settings, mailer: RecordingMailer
) -> None:
    _wire(app, FakeUsers(), mailer, settings)

    response = client.post(REGISTER, json={"email": "not-an-email", "password": A_PASSWORD})

    assert response.status_code == 422


def test_a_short_password_is_refused(
    app: FastAPI, client: TestClient, settings: Settings, mailer: RecordingMailer
) -> None:
    _wire(app, FakeUsers(), mailer, settings)

    assert client.post(REGISTER, json={"email": AN_EMAIL, "password": "short"}).status_code == 422


def test_an_unknown_time_zone_is_refused(
    app: FastAPI, client: TestClient, settings: Settings, mailer: RecordingMailer
) -> None:
    _wire(app, FakeUsers(), mailer, settings)

    response = client.post(
        REGISTER,
        json={"email": AN_EMAIL, "password": A_PASSWORD, "timezone": "Marte/Olympus"},
    )

    assert response.status_code == 422


def _register_and_take_token(service: RegistrationService, mailer: RecordingMailer) -> str:
    service.register(AN_EMAIL, A_PASSWORD, "America/Sao_Paulo")
    link = mailer.to(AN_EMAIL)[0].text
    return link.split("/verify?token=")[1].split("\n")[0].strip()


def test_a_valid_token_confirms_the_account(settings: Settings, mailer: RecordingMailer) -> None:
    users = FakeUsers()
    service = _service(users, mailer, settings)
    raw = _register_and_take_token(service, mailer)

    user = service.verify(raw)

    assert user.verified_at is not None
    assert users.rows[0].verified_at is not None


def test_a_token_works_only_once(settings: Settings, mailer: RecordingMailer) -> None:
    service = _service(FakeUsers(), mailer, settings)
    raw = _register_and_take_token(service, mailer)
    service.verify(raw)

    with pytest.raises(InvalidLinkTokenError):
        service.verify(raw)


def test_an_expired_token_is_refused(settings: Settings, mailer: RecordingMailer) -> None:
    users = FakeUsers()
    tokens = FakeTokens(users)
    service = RegistrationService(users, tokens, mailer, settings)  # type: ignore[arg-type]
    raw = _register_and_take_token(service, mailer)
    tokens.rows[0].expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    with pytest.raises(InvalidLinkTokenError):
        service.verify(raw)


def test_an_unknown_token_is_refused(settings: Settings, mailer: RecordingMailer) -> None:
    with pytest.raises(InvalidLinkTokenError):
        _service(FakeUsers(), mailer, settings).verify("never issued")


def test_the_stored_token_is_a_digest_not_the_link(
    settings: Settings, mailer: RecordingMailer
) -> None:
    """A database leak must not hand over the ability to confirm somebody else's address."""
    users = FakeUsers()
    tokens = FakeTokens(users)
    service = RegistrationService(users, tokens, mailer, settings)  # type: ignore[arg-type]

    raw = _register_and_take_token(service, mailer)

    assert tokens.rows[0].token_hash == hash_token(raw)
    assert raw not in tokens.rows[0].token_hash


def test_resending_issues_a_fresh_link_for_an_unverified_account(
    settings: Settings, mailer: RecordingMailer
) -> None:
    users = FakeUsers()
    service = _service(users, mailer, settings)
    first = _register_and_take_token(service, mailer)
    mailer.clear()

    service.resend(AN_EMAIL)

    second = mailer.to(AN_EMAIL)[0].text.split("/verify?token=")[1].split("\n")[0].strip()
    assert second != first


def test_resending_for_a_verified_account_sends_nothing(
    settings: Settings, mailer: RecordingMailer
) -> None:
    service = _service(FakeUsers(_existing(verified=True)), mailer, settings)

    service.resend(AN_EMAIL)

    assert mailer.sent == []


def test_resending_for_an_unknown_address_sends_nothing(
    settings: Settings, mailer: RecordingMailer
) -> None:
    """Silent, so this does not become the oracle registration stopped being."""
    service = _service(FakeUsers(), mailer, settings)

    service.resend("nobody@example.com")

    assert mailer.sent == []
