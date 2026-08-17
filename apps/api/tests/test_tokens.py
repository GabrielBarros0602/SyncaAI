"""Tests for access tokens.

Times are expressed relative to the real clock rather than to a frozen instant. PyJWT
validates ``exp`` and ``iat`` against the process clock and offers no hook to override it,
so only the minting side can be moved: a token is minted at a chosen age and then decoded
against real time. Freezing both sides would require patching inside the library.

That constraint also produces a property worth asserting on its own — a token claiming to
have been issued in the future is refused, which is what stops a forgery from buying
itself validity with a bogus timestamp.
"""

import time
import uuid

import jwt
import pytest

from syncaai.config import get_settings
from syncaai.security import tokens
from syncaai.security.tokens import (
    ACCESS_TOKEN_TYPE,
    ALGORITHM,
    InvalidTokenError,
    create_access_token,
    decode_access_token,
)

A_USER = uuid.uuid4()


@pytest.fixture(autouse=True)
def _a_known_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("JWT_SECRET", "a-secret-only-for-tests-long-enough-for-hs256")


def _freeze(monkeypatch: pytest.MonkeyPatch, at: int) -> None:
    monkeypatch.setattr(tokens, "_now", lambda: at)


def test_a_token_round_trips_to_the_user_it_names() -> None:
    assert decode_access_token(create_access_token(A_USER)) == A_USER


def test_the_payload_carries_the_expected_claims(monkeypatch: pytest.MonkeyPatch) -> None:
    minted_at = int(time.time())
    _freeze(monkeypatch, minted_at)

    payload = jwt.decode(
        create_access_token(A_USER),
        get_settings().jwt_secret,
        algorithms=[ALGORITHM],
    )

    assert payload["sub"] == str(A_USER)
    assert payload["iat"] == minted_at
    assert payload["exp"] == minted_at + get_settings().access_token_minutes * 60
    assert payload["typ"] == ACCESS_TOKEN_TYPE


def test_an_expired_token_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    lifetime = get_settings().access_token_minutes * 60
    _freeze(monkeypatch, int(time.time()) - lifetime - 60)

    token = create_access_token(A_USER)

    with pytest.raises(InvalidTokenError):
        decode_access_token(token)


def test_a_token_near_the_end_of_its_window_is_still_accepted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lifetime = get_settings().access_token_minutes * 60
    _freeze(monkeypatch, int(time.time()) - lifetime + 60)

    assert decode_access_token(create_access_token(A_USER)) == A_USER


def test_a_token_issued_in_the_future_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    """A forgery cannot buy itself validity by claiming a later issue time."""
    _freeze(monkeypatch, int(time.time()) + 3600)

    with pytest.raises(InvalidTokenError):
        decode_access_token(create_access_token(A_USER))


def test_a_token_signed_with_another_secret_is_rejected() -> None:
    forged = jwt.encode(
        {"sub": str(A_USER), "iat": 1, "exp": 9_999_999_999, "typ": ACCESS_TOKEN_TYPE},
        "a-different-secret-also-long-enough-for-hs256",
        algorithm=ALGORITHM,
    )

    with pytest.raises(InvalidTokenError):
        decode_access_token(forged)


def test_a_token_of_another_type_is_rejected() -> None:
    """Signed by us and otherwise valid, but minted for a different purpose."""
    other = jwt.encode(
        {"sub": str(A_USER), "iat": 1, "exp": 9_999_999_999, "typ": "refresh"},
        get_settings().jwt_secret,
        algorithm=ALGORITHM,
    )

    with pytest.raises(InvalidTokenError):
        decode_access_token(other)


def test_a_token_without_an_expiry_is_rejected() -> None:
    """An unsigned lifetime would be a token that never expires."""
    without_expiry = jwt.encode(
        {"sub": str(A_USER), "iat": 1, "typ": ACCESS_TOKEN_TYPE},
        get_settings().jwt_secret,
        algorithm=ALGORITHM,
    )

    with pytest.raises(InvalidTokenError):
        decode_access_token(without_expiry)


def test_a_subject_that_is_not_a_uuid_is_rejected() -> None:
    nonsense = jwt.encode(
        {"sub": "not-a-uuid", "iat": 1, "exp": 9_999_999_999, "typ": ACCESS_TOKEN_TYPE},
        get_settings().jwt_secret,
        algorithm=ALGORITHM,
    )

    with pytest.raises(InvalidTokenError):
        decode_access_token(nonsense)


def test_garbage_is_rejected() -> None:
    with pytest.raises(InvalidTokenError):
        decode_access_token("not.a.token")
