"""Registration and login payloads."""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from syncaai.security.passwords import MAX_PASSWORD_LENGTH
from syncaai.time_windows import is_valid_timezone

# NIST SP 800-63B asks for at least eight characters and no composition rules. A higher
# floor mostly annoys people: what makes an offline attack expensive here is argon2, not
# forcing a twelfth character. Checking candidates against a breach list would help more
# and is not in scope yet.
MIN_PASSWORD_LENGTH = 8

DEFAULT_TIMEZONE = "America/Sao_Paulo"


def _normalise_email(value: str) -> str:
    """Lowercase the whole address.

    RFC 5321 makes the local part case-sensitive, so ``A@x.com`` and ``a@x.com`` are
    formally different mailboxes. No provider in practice treats them as different, and
    accepting both as separate accounts is how a user ends up locked out of the one they
    created. This is a deliberate departure from the specification.
    """
    return value.strip().lower()


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)
    timezone: str = DEFAULT_TIMEZONE

    @field_validator("email")
    @classmethod
    def normalise(cls, value: str) -> str:
        return _normalise_email(value)

    @field_validator("timezone")
    @classmethod
    def known_timezone(cls, value: str) -> str:
        if not is_valid_timezone(value):
            message = f"unknown time zone {value!r}"
            raise ValueError(message)
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=MAX_PASSWORD_LENGTH)

    # Decides how the refresh token is delivered, and the two are exclusive: a web client
    # gets a cookie and no token in the body, a native client the reverse (ADR-0017). It is
    # a request field rather than the response carrying both, so a browser taking the body
    # path has to declare itself native — a deliberate, visible act.
    client: Literal["web", "native"] = "web"

    @field_validator("email")
    @classmethod
    def normalise(cls, value: str) -> str:
        return _normalise_email(value)


class VerifyRequest(BaseModel):
    token: str


class ResendRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalise(cls, value: str) -> str:
        return _normalise_email(value)


class AcceptedResponse(BaseModel):
    """The one answer registration gives, whatever happened behind it."""

    detail: str = (
        "If that address is new, a confirmation link is on its way. "
        "Check your inbox to finish signing up."
    )


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    timezone: str
    created_at: datetime


class RefreshRequest(BaseModel):
    """A native client sends the token here; a web client sends nothing and uses its cookie."""

    refresh_token: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int

    # Present only for a native client. Absent for a web client, whose token is in a cookie
    # the response sets and JavaScript cannot read.
    refresh_token: str | None = None
