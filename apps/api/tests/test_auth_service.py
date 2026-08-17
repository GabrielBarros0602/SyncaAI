"""Unit tests for registration and authentication rules.

A fake repository stands in for the database, so these are fast and cover the rules rather
than the wiring. The endpoint tests cover the wiring.
"""

import uuid
from datetime import datetime

import pytest

from syncaai.errors import EmailAlreadyRegisteredError, InvalidCredentialsError
from syncaai.models import User
from syncaai.security import passwords
from syncaai.security.passwords import hash_password
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


def _existing(email: str = AN_EMAIL, password: str = A_PASSWORD) -> User:
    user = User(email=email, password_hash=hash_password(password), timezone=A_ZONE)
    user.id = uuid.uuid4()
    user.created_at = A_TIMESTAMP
    return user


def test_registering_stores_a_hash_and_never_the_password() -> None:
    users = FakeUsers()

    user = AuthService(users).register(AN_EMAIL, A_PASSWORD, A_ZONE)

    assert user.password_hash != A_PASSWORD
    assert A_PASSWORD not in user.password_hash
    assert users.rows == [user]


def test_registering_an_address_that_already_exists_is_refused() -> None:
    service = AuthService(FakeUsers(_existing()))

    with pytest.raises(EmailAlreadyRegisteredError):
        service.register(AN_EMAIL, A_PASSWORD, A_ZONE)


def test_the_right_credentials_authenticate() -> None:
    existing = _existing()

    assert AuthService(FakeUsers(existing)).authenticate(AN_EMAIL, A_PASSWORD) is existing


def test_a_wrong_password_is_refused() -> None:
    service = AuthService(FakeUsers(_existing()))

    with pytest.raises(InvalidCredentialsError):
        service.authenticate(AN_EMAIL, "not the password")


def test_an_unknown_address_is_refused_with_the_same_error() -> None:
    """Same exception as a wrong password, so the caller cannot tell them apart."""
    service = AuthService(FakeUsers())

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
        AuthService(FakeUsers()).authenticate("nobody@example.com", A_PASSWORD)

    assert calls, "verify_dummy was not called for an unknown address"


def test_a_successful_login_upgrades_a_weaker_hash(monkeypatch: pytest.MonkeyPatch) -> None:
    """The only moment the plain password is available is the only moment this is possible."""
    existing = _existing()
    stale_hash = existing.password_hash
    monkeypatch.setattr("syncaai.services.auth.needs_rehash", lambda _: True)

    AuthService(FakeUsers(existing)).authenticate(AN_EMAIL, A_PASSWORD)

    assert existing.password_hash != stale_hash
