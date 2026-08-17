"""Refresh tokens.

Opaque and random, unlike the access token, so that a session can be revoked by deleting a
row rather than by rotating a signing secret and logging everyone out (ADR-0015).

Stored as a SHA-256 digest. A fast hash is correct here and argon2 would be wrong: argon2
exists to make guessing a *low-entropy* human-chosen secret expensive. This value is 384
bits from the system random source, so guessing is not the threat — the threat is a database
leak handing over live sessions, and a digest answers that at no cost per refresh.
"""

import hashlib
import secrets

# 48 bytes, urlsafe-encoded to 64 characters. Well past the point where guessing is
# arithmetic rather than a risk.
_TOKEN_BYTES = 48

# SHA-256 hex is always 64 characters, which is what the column is sized for.
TOKEN_HASH_LENGTH = 64


def generate_refresh_token() -> str:
    """Return a new opaque token. This is the only time the raw value exists."""
    return secrets.token_urlsafe(_TOKEN_BYTES)


def hash_refresh_token(token: str) -> str:
    """Return the digest stored against the session."""
    return hashlib.sha256(token.encode()).hexdigest()
