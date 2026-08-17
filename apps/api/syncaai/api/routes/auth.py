"""Registration, login, refresh and logout."""

from typing import Annotated

from fastapi import APIRouter, Body, Cookie, Depends, Response, status
from sqlalchemy.orm import Session

from syncaai.config import Settings, get_settings
from syncaai.db import get_session
from syncaai.errors import InvalidCredentialsError
from syncaai.repositories.refresh_tokens import RefreshTokenRepository
from syncaai.repositories.users import UserRepository
from syncaai.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserRead,
)
from syncaai.security.tokens import create_access_token
from syncaai.services.auth import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE_NAME = "syncaai_refresh"

# Scoped to the auth endpoints, so the cookie is not attached to every other request the
# browser makes to this API. Nothing outside these paths has any use for it.
REFRESH_COOKIE_PATH = "/api/v1/auth"


def get_auth_service(session: Annotated[Session, Depends(get_session)]) -> AuthService:
    return AuthService(UserRepository(session), RefreshTokenRepository(session))


ServiceDep = Annotated[AuthService, Depends(get_auth_service)]
SessionDep = Annotated[Session, Depends(get_session)]


def _set_refresh_cookie(response: Response, raw_token: str, settings: Settings) -> None:
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        raw_token,
        max_age=settings.refresh_token_days * 24 * 60 * 60,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        samesite="strict",
        # The one place app_env changes a security property, which ADR-0017 records as a
        # risk: an environment misconfigured as local in production would drop Secure.
        secure=settings.app_env != "local",
    )


@router.post("/register", status_code=status.HTTP_201_CREATED, summary="Create an account")
def register(payload: RegisterRequest, service: ServiceDep, session: SessionDep) -> UserRead:
    """Create an account and return it.

    No token is issued here. Registration is the rare path, and minting credentials in two
    places doubles what has to be audited; the client logs in afterwards.
    """
    user = service.register(payload.email, payload.password, payload.timezone)
    session.commit()
    return UserRead.model_validate(user)


@router.post("/login", summary="Exchange credentials for tokens")
def login(
    payload: LoginRequest, service: ServiceDep, session: SessionDep, response: Response
) -> TokenResponse:
    """Authenticate and open a session.

    Where the refresh token goes depends on what the client says it is, and the two channels
    are exclusive — never both in one response (ADR-0017).
    """
    user = service.authenticate(payload.email, payload.password)
    raw_refresh = service.issue_refresh_token(user)
    session.commit()

    settings = get_settings()
    body = TokenResponse(
        access_token=create_access_token(user.id),
        expires_in=settings.access_token_minutes * 60,
    )

    if payload.client == "native":
        return body.model_copy(update={"refresh_token": raw_refresh})

    _set_refresh_cookie(response, raw_refresh, settings)
    return body


@router.post("/refresh", summary="Exchange a refresh token for a new access token")
def refresh(
    service: ServiceDep,
    session: SessionDep,
    payload: Annotated[RefreshRequest | None, Body()] = None,
    cookie_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE_NAME)] = None,
) -> TokenResponse:
    """Mint a new access token from a live session.

    The refresh token is not rotated: ADR-0015 chose revocability, and left rotation with
    reuse detection as the next step rather than part of this one.
    """
    raw_refresh = (payload.refresh_token if payload else None) or cookie_token
    if raw_refresh is None:
        raise InvalidCredentialsError

    user = service.exchange_refresh_token(raw_refresh)
    session.commit()

    return TokenResponse(
        access_token=create_access_token(user.id),
        expires_in=get_settings().access_token_minutes * 60,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="End a session")
def logout(
    service: ServiceDep,
    session: SessionDep,
    response: Response,
    payload: Annotated[RefreshRequest | None, Body()] = None,
    cookie_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE_NAME)] = None,
) -> None:
    """Revoke the presented session.

    Answers 204 whether or not the token was real, so it reveals nothing. The cookie is
    cleared either way, since a client asking to log out should end up logged out.
    """
    raw_refresh = (payload.refresh_token if payload else None) or cookie_token
    if raw_refresh is not None:
        service.revoke_refresh_token(raw_refresh)
        session.commit()

    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
