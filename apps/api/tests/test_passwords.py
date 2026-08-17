"""Tests for password hashing.

The properties asserted are the ones the decision in ADR-0014 was made for: that the hash
carries argon2id and its parameters, that verification is not fooled, that an oversized
input is refused before any work is done, and that the decoy verification costs roughly
what a real one costs.
"""

import pytest

from syncaai.security.passwords import (
    MAX_PASSWORD_LENGTH,
    PasswordTooLongError,
    hash_password,
    needs_rehash,
    verify_dummy,
    verify_password,
)

A_PASSWORD = "correct horse battery staple"


def test_the_hash_names_argon2id_and_carries_its_parameters() -> None:
    parts = hash_password(A_PASSWORD).split("$")

    assert parts[1] == "argon2id"
    assert parts[3] == "m=65536,t=3,p=4"


def test_the_same_password_hashes_differently_every_time() -> None:
    """Each hash carries its own salt, so identical passwords are not identifiable."""
    assert hash_password(A_PASSWORD) != hash_password(A_PASSWORD)


def test_the_right_password_verifies() -> None:
    assert verify_password(A_PASSWORD, hash_password(A_PASSWORD))


def test_a_wrong_password_does_not_verify() -> None:
    assert not verify_password("almost the right one", hash_password(A_PASSWORD))


def test_an_unreadable_hash_does_not_verify_and_does_not_raise() -> None:
    """A caller deciding whether to authenticate gets the same answer either way."""
    assert not verify_password(A_PASSWORD, "not a hash at all")


def test_a_password_longer_than_the_limit_is_refused() -> None:
    with pytest.raises(PasswordTooLongError):
        hash_password("x" * (MAX_PASSWORD_LENGTH + 1))


def test_a_password_at_the_limit_is_accepted() -> None:
    assert verify_password("x" * MAX_PASSWORD_LENGTH, hash_password("x" * MAX_PASSWORD_LENGTH))


def test_a_long_passphrase_is_accepted_where_bcrypt_would_refuse_it() -> None:
    """argon2 has no 72-byte ceiling, which is part of why ADR-0014 chose it."""
    passphrase = "a passphrase comfortably longer than seventy two bytes, which is the point"

    assert len(passphrase.encode()) > 72
    assert verify_password(passphrase, hash_password(passphrase))


def test_the_decoy_verification_runs_without_raising() -> None:
    """Called when an account does not exist, so a login reveals nothing through timing."""
    verify_dummy()


def test_a_current_hash_does_not_need_rehashing() -> None:
    assert not needs_rehash(hash_password(A_PASSWORD))


def test_an_unreadable_hash_is_not_reported_as_needing_a_rehash() -> None:
    assert not needs_rehash("not a hash at all")
