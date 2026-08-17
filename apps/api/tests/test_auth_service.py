"""Unit tests for registration and authentication rules.

A fake repository stands in for the database, so these are fast and cover the rules rather
than the wiring. The endpoint tests cover the wiring.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from syncaai.config import Settings
from syncaai.errors import EmailAlreadyRegisteredError, InvalidCredentialsError
from syncaai.models import RefreshToken, User
from syncaai.security import passwords
from syncaai.security.passwords import hash_password
from syncaai.security.refresh import hash_refresh_token
from syncaai.services.auth import AuthService

AN_EMAIL = "gabriel@example.com"
A_PASSWORD = "a decent password"
A_ZONE = "America/Sao_Paulo"

# The real column is timestamptz filled by the database. A fake only needs a datetime for
# the response model to serialise.
A_TIMESTAMP = datetime(2026, 8, 17, 12, 0)


class FakeUsers:
    """Stands in for UserRepository, including the identity the database would assign."""

    def __init__(self, *users: User) -> None:
        self.rows = list(users)

    def get_by_email(self, email: str) -> User | None:
        return next((user for user in self.rows if user.email == email), None)

    def add(self, user: User) -> None:
        user.id = uuid.uuid4()
        user.created_at = A_TIMESTAMP
        self.rows.append(user)


class FakeSessions:
    """Stands in for RefreshTokenRepository, including the relationship the ORM would load."""

    def __init__(self, users: FakeUsers) -> None:
        self._users = users
        self.rows: list[RefreshToken] = []

    def get_by_hash(self, token_hash: str) -> RefreshToken | None:
        return next((row for row in self.rows if row.token_hash == token_hash), None)

    def add(self, token: RefreshToken) -> None:
        token.id = uuid.uuid4()
        token.created_at = A_TIMESTAMP
        token.user = next(user for user in self._users.rows if user.id == token.user_id)
        self.rows.append(token)


A_SETTINGS = Settings(
    database_url="postgresql+psycopg://user:pass@localhost:5432/syncaai_test",
    jwt_secret="a-secret-only-for-tests-long-enough-for-hs256",
    _env_file=None,
)


def _service(*users: User) -> AuthService:
    people = FakeUsers(*users)
    return AuthService(people, FakeSessions(people), A_SETTINGS)  # type: ignore[arg-type]


def _existing(email: str = AN_EMAIL, password: str = A_PASSWORD) -> User:
    user = User(email=email, password_hash=hash_password(password), timezone=A_ZONE)
    user.id = uuid.uuid4()
    user.created_at = A_TIMESTAMP
    return user


def test_registering_stores_a_hash_and_never_the_password() -> None:
    users = FakeUsers()
    service = AuthService(users, FakeSessions(users), A_SETTINGS)  # type: ignore[arg-type]

    user = service.register(AN_EMAIL, A_PASSWORD, A_ZONE)

    assert user.password_hash != A_PASSWORD
    assert A_PASSWORD not in user.password_hash
    assert users.rows == [user]


def test_registering_an_address_that_already_exists_is_refused() -> None:
    service = _service(_existing())

    with pytest.raises(EmailAlreadyRegisteredError):
        service.register(AN_EMAIL, A_PASSWORD, A_ZONE)


def test_the_right_credentials_authenticate() -> None:
    existing = _existing()

    assert _service(existing).authenticate(AN_EMAIL, A_PASSWORD) is existing


def test_a_wrong_password_is_refused() -> None:
    service = _service(_existing())

    with pytest.raises(InvalidCredentialsError):
        service.authenticate(AN_EMAIL, "not the password")


def test_an_unknown_address_is_refused_with_the_same_error() -> None:
    """Same exception as a wrong password, so the caller cannot tell them apart."""
    service = _service()

    with pytest.raises(InvalidCredentialsError):
        service.authenticate("nobody@example.com", A_PASSWORD)


def test_an_unknown_address_still_pays_the_hashing_cost(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Without this, response time answers whether an address is registered."""
    calls: list[int] = []
    monkeypatch.setattr(passwords, "verify_dummy", lambda: calls.append(1))
    monkeypatch.setattr("syncaai.services.auth.verify_dummy", lambda: calls.append(1))

    with pytest.raises(InvalidCredentialsError):
        _service().authenticate("nobody@example.com", A_PASSWORD)

    assert calls, "verify_dummy was not called for an unknown address"


def test_a_successful_login_upgrades_a_weaker_hash(monkeypatch: pytest.MonkeyPatch) -> None:
    """The only moment the plain password is available is the only moment this is possible."""
    existing = _existing()
    stale_hash = existing.password_hash
    monkeypatch.setattr("syncaai.services.auth.needs_rehash", lambda _: True)

    _service(existing).authenticate(AN_EMAIL, A_PASSWORD)

    assert existing.password_hash != stale_hash


def test_issuing_a_session_stores_only_the_digest() -> None:
    user = _existing()
    people = FakeUsers(user)
    sessions = FakeSessions(people)
    service = AuthService(people, sessions, A_SETTINGS)  # type: ignore[arg-type]

    raw = service.issue_refresh_token(user)

    assert raw not in [row.token_hash for row in sessions.rows]
    assert sessions.rows[0].token_hash == hash_refresh_token(raw)


def test_a_live_session_resolves_to_its_owner() -> None:
    user = _existing()
    people = FakeUsers(user)
    service = AuthService(people, FakeSessions(people), A_SETTINGS)  # type: ignore[arg-type]
    raw = service.issue_refresh_token(user)

    assert service.exchange_refresh_token(raw) is user


def test_an_unknown_session_is_refused() -> None:
    with pytest.raises(InvalidCredentialsError):
        _service(_existing()).exchange_refresh_token("never issued")


def test_a_revoked_session_is_refused() -> None:
    user = _existing()
    people = FakeUsers(user)
    service = AuthService(people, FakeSessions(people), A_SETTINGS)  # type: ignore[arg-type]
    raw = service.issue_refresh_token(user)

    service.revoke_refresh_token(raw)

    with pytest.raises(InvalidCredentialsError):
        service.exchange_refresh_token(raw)


def test_an_expired_session_is_refused() -> None:
    user = _existing()
    people = FakeUsers(user)
    sessions = FakeSessions(people)
    service = AuthService(people, sessions, A_SETTINGS)  # type: ignore[arg-type]
    raw = service.issue_refresh_token(user)
    sessions.rows[0].expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)

    with pytest.raises(InvalidCredentialsError):
        service.exchange_refresh_token(raw)


def test_revoking_an_unknown_session_is_silent() -> None:
    """Logging out answers the same way regardless, so it reveals nothing."""
    _service(_existing()).revoke_refresh_token("never issued")
