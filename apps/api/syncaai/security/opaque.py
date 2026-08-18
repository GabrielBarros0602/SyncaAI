"""Opaque tokens.

Random values that are never guessed, only presented: a session, a verification link, a
password reset. All three want the same thing — enough entropy that guessing is arithmetic
rather than a risk, and a digest at rest so a database leak yields nothing usable.

A fast digest is correct and argon2 would be wrong. argon2 exists to make guessing an
expensive proposition for a low-entropy secret a human chose. These are not that.
"""

import hashlib
import secrets

# 48 bytes, urlsafe-encoded to 64 characters.
_TOKEN_BYTES = 48

# SHA-256 hex is always 64 characters, which is what the columns are sized for.
TOKEN_HASH_LENGTH = 64


def generate_token() -> str:
    """Return a new token. This is the only moment the raw value exists."""
    return secrets.token_urlsafe(_TOKEN_BYTES)


def hash_token(token: str) -> str:
    """Return the digest stored against it."""
    return hashlib.sha256(token.encode()).hexdigest()
