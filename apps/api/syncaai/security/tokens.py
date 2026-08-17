"""Access tokens.

A short-lived signed JWT carried in the ``Authorization`` header, per ADR-0015. Verifying
one is a signature check, so the common path — an authenticated request — touches no
database. Sessions that must be cancellable are the refresh token's job, and a refresh
token is an opaque database row rather than a JWT.

HS256 because one service signs and the same service verifies. An asymmetric key pair buys
nothing here and adds key management.

Timestamps are Unix seconds rather than datetimes: that is what a JWT carries by
specification, so converting through ``datetime`` would only add a step that can be got
wrong.

Settings arrive as an argument rather than being read from the cached accessor. A security
primitive reaching for global state hides an input, and the cache made that input
impossible to change from a test without remembering to clear it — a failure that produced
passing tests asserting the wrong value.
"""

import time
from uuid import UUID

import jwt

from syncaai.config import Settings

ALGORITHM = "HS256"
ACCESS_TOKEN_TYPE = "access"


class InvalidTokenError(Exception):
    """Raised when a token is malformed, expired, wrongly signed, or not an access token."""


def create_access_token(user_id: UUID, settings: Settings) -> str:
    """Mint an access token for a user."""
    issued_at = _now()
    payload = {
        "sub": str(user_id),
        "iat": issued_at,
        "exp": issued_at + settings.access_token_minutes * 60,
        "typ": ACCESS_TOKEN_TYPE,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def decode_access_token(token: str, settings: Settings) -> UUID:
    """Return the user id a valid access token names.

    Every failure raises the same exception. A caller deciding whether to authenticate has
    no use for the difference between expired, forged and malformed, and reporting it would
    tell an attacker which part of a forgery attempt to fix.
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            options={"require": ["sub", "exp", "iat"]},
        )
    except jwt.PyJWTError as error:
        raise InvalidTokenError from error

    # A token minted for another purpose must not be accepted here, even if it is otherwise
    # valid and signed by us.
    if payload.get("typ") != ACCESS_TOKEN_TYPE:
        raise InvalidTokenError

    try:
        return UUID(payload["sub"])
    except (TypeError, ValueError) as error:
        raise InvalidTokenError from error


def _now() -> int:
    """Current time in Unix seconds. Indirected so tests can control it."""
    return int(time.time())
