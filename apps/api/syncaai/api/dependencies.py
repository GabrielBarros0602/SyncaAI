"""Request-scoped dependencies shared by the API."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from syncaai.config import Settings, get_settings
from syncaai.db import get_session
from syncaai.errors import InvalidCredentialsError
from syncaai.models import User
from syncaai.repositories.users import UserRepository
from syncaai.security.tokens import InvalidTokenError, decode_access_token

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
