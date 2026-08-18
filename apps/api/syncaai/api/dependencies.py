"""Request-scoped dependencies shared by the API."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from syncaai.config import Settings, get_settings
from syncaai.db import get_session
from syncaai.errors import InvalidCredentialsError
from syncaai.mail import ConsoleMailer, Mailer, RecordingMailer
from syncaai.models import User
from syncaai.repositories.users import UserRepository
from syncaai.security.tokens import InvalidTokenError, decode_access_token
from syncaai.services.rate_limit import RateLimiter

# auto_error=False so a missing or malformed header reaches this module rather than
# producing FastAPI's default body. Every authentication failure in this API answers the
# same way, and that is only true if one place decides it.
_bearer = HTTPBearer(auto_error=False)

SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[Session, Depends(get_session)]
CredentialsDep = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]


def get_current_user_id(credentials: CredentialsDep, settings: SettingsDep) -> UUID:
    """Return the user a valid access token names, without touching the database.

    This is the dependency almost every endpoint wants. ADR-0015 chose a signed token so
    that an authenticated request is a signature check, and loading the user row on every
    request would give that away for information most endpoints do not use — they need an
    owner to scope by, which is exactly this value.

    The cost is that a token stays valid for its remaining lifetime after the account it
    names is deleted. That window is bounded by the access token's thirty minutes, and
    ending a session sooner is what the revocable refresh token is for.
    """
    if credentials is None:
        raise InvalidCredentialsError

    try:
        return decode_access_token(credentials.credentials, settings)
    except InvalidTokenError as error:
        raise InvalidCredentialsError from error


CurrentUserId = Annotated[UUID, Depends(get_current_user_id)]


def get_current_user(user_id: CurrentUserId, session: SessionDep) -> User:
    """Return the authenticated user's row.

    For the endpoints that need more than an owner to scope by — the calendar ones need
    ``timezone`` to convert a local window. Everything else should take ``CurrentUserId``
    and stay off the database.

    A token naming a user that no longer exists is refused here rather than raising later
    on a null.
    """
    user = UserRepository(session).get_by_id(user_id)
    if user is None:
        raise InvalidCredentialsError
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_client_address(request: Request) -> str:
    """Identify the caller for rate limiting.

    Behind a proxy every request arrives from the proxy, so this collapses into a single
    global bucket unless uvicorn runs with proxy headers enabled and a trusted forwarder
    list. Trusting ``X-Forwarded-For`` unconditionally would be worse than not limiting at
    all: the header is client-controlled, so anyone could mint a fresh allowance per
    request. Deployment carries this, and it is recorded for S11.
    """
    return request.client.host if request.client else "unknown"


ClientAddress = Annotated[str, Depends(get_client_address)]


def limit_login(address: ClientAddress, session: SessionDep, settings: SettingsDep) -> None:
    """Bound credential guessing per caller."""
    RateLimiter(session).check(f"login:{address}", settings.login_attempts_per_hour)


def limit_registration(address: ClientAddress, session: SessionDep, settings: SettingsDep) -> None:
    """Bound registrations per caller.

    Each attempt costs a 64 MiB argon2 hash, so an unlimited endpoint is a memory
    exhaustion vector on its own, before any question of account enumeration.
    """
    RateLimiter(session).check(f"register:{address}", settings.registrations_per_hour)


# One instance per process rather than per request. A recording mailer that was rebuilt on
# every request would forget everything between them, which would make it useless as the
# evidence ADR-0019 relies on.
_MAILERS: dict[str, Mailer] = {"console": ConsoleMailer(), "recording": RecordingMailer()}


def get_mailer(settings: SettingsDep) -> Mailer:
    """Return the configured mailer."""
    return _MAILERS[settings.mail_backend]


MailerDep = Annotated[Mailer, Depends(get_mailer)]
