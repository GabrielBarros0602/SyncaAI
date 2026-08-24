"""Registration, login, refresh and logout."""

from typing import Annotated

from fastapi import APIRouter, Body, Cookie, Depends, Response, status
from sqlalchemy.orm import Session

from syncaai.api.dependencies import (
    MailerDep,
    limit_login,
    limit_password_reset,
    limit_registration,
    limit_verification_resend,
)
from syncaai.config import Settings, get_settings
from syncaai.db import get_session
from syncaai.errors import InvalidCredentialsError
from syncaai.repositories.password_reset_tokens import PasswordResetTokenRepository
from syncaai.repositories.refresh_tokens import RefreshTokenRepository
from syncaai.repositories.users import UserRepository
from syncaai.repositories.verification_tokens import VerificationTokenRepository
from syncaai.schemas.auth import (
    PASSWORD_RESET_ACCEPTED,
    REGISTRATION_ACCEPTED,
    VERIFICATION_RESEND_ACCEPTED,
    AcceptedResponse,
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResendRequest,
    ResetPasswordRequest,
    TokenResponse,
    VerifyRequest,
)
from syncaai.security.tokens import create_access_token
from syncaai.services.auth import AuthService
from syncaai.services.password_reset import PasswordResetService
from syncaai.services.registration import RegistrationService

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE_NAME = "syncaai_refresh"

# Scoped to the auth endpoints, so the cookie is not attached to every other request the
# browser makes to this API. Nothing outside these paths has any use for it.
REFRESH_COOKIE_PATH = "/api/v1/auth"


SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_auth_service(
    session: Annotated[Session, Depends(get_session)], settings: SettingsDep
) -> AuthService:
    return AuthService(UserRepository(session), RefreshTokenRepository(session), settings)


def get_registration_service(
    session: Annotated[Session, Depends(get_session)], settings: SettingsDep, mailer: MailerDep
) -> RegistrationService:
    return RegistrationService(
        UserRepository(session), VerificationTokenRepository(session), mailer, settings
    )


ServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def get_password_reset_service(
    session: Annotated[Session, Depends(get_session)], settings: SettingsDep, mailer: MailerDep
) -> PasswordResetService:
    return PasswordResetService(
        UserRepository(session),
        PasswordResetTokenRepository(session),
        RefreshTokenRepository(session),
        mailer,
        settings,
    )


RegistrationDep = Annotated[RegistrationService, Depends(get_registration_service)]
PasswordResetDep = Annotated[PasswordResetService, Depends(get_password_reset_service)]
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


@router.post(
    "/register",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ask to create an account",
    dependencies=[Depends(limit_registration)],
)
def register(
    payload: RegisterRequest, service: RegistrationDep, session: SessionDep
) -> AcceptedResponse:
    """Answer the same thing whether or not the address already has an account.

    202 rather than 201: nothing usable was created from the caller's point of view, and
    saying "created" would be a claim only true in one of the two cases.
    """
    service.register(payload.email, payload.password, payload.timezone)
    session.commit()
    return AcceptedResponse(detail=REGISTRATION_ACCEPTED)


@router.post("/verify", status_code=status.HTTP_204_NO_CONTENT, summary="Confirm an address")
def verify(payload: VerifyRequest, service: RegistrationDep, session: SessionDep) -> None:
    """Spend a confirmation token.

    A POST rather than a link the mail client can follow. Scanners fetch links in mail, and
    a scanner would spend the token before its owner ever clicked; the page behind the link
    posts here instead (ADR-0019).
    """
    service.verify(payload.token)
    session.commit()


@router.post(
    "/resend-verification",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ask for another confirmation link",
    dependencies=[Depends(limit_verification_resend)],
)
def resend_verification(
    payload: ResendRequest, service: RegistrationDep, session: SessionDep
) -> AcceptedResponse:
    """Answer the same thing whether or not there was anything to send.

    A different answer here would restore the oracle registration stopped being.
    """
    service.resend(payload.email)
    session.commit()
    return AcceptedResponse(detail=VERIFICATION_RESEND_ACCEPTED)


@router.post(
    "/forgot-password",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ask for a password reset link",
    dependencies=[Depends(limit_password_reset)],
)
def forgot_password(
    payload: ForgotPasswordRequest, service: PasswordResetDep, session: SessionDep
) -> AcceptedResponse:
    """Answer the same thing whether or not there is an account.

    This is the path that would reopen everything the sprint closed: it asks the same
    question registration asks, in a different shape.
    """
    service.request(payload.email)
    session.commit()
    return AcceptedResponse(detail=PASSWORD_RESET_ACCEPTED)


@router.post(
    "/reset-password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Set a new password",
)
def reset_password(
    payload: ResetPasswordRequest, service: PasswordResetDep, session: SessionDep
) -> None:
    """Spend a reset token and sign every device out."""
    service.reset(payload.token, payload.password)
    session.commit()


@router.post(
    "/login",
    summary="Exchange credentials for tokens",
    dependencies=[Depends(limit_login)],
)
def login(
    payload: LoginRequest,
    service: ServiceDep,
    session: SessionDep,
    settings: SettingsDep,
    response: Response,
) -> TokenResponse:
    """Authenticate and open a session.

    Where the refresh token goes depends on what the client says it is, and the two channels
    are exclusive — never both in one response (ADR-0017).
    """
    user = service.authenticate(payload.email, payload.password)
    raw_refresh = service.issue_refresh_token(user)
    session.commit()

    body = TokenResponse(
        access_token=create_access_token(user.id, settings),
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
    settings: SettingsDep,
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
        access_token=create_access_token(user.id, settings),
        expires_in=settings.access_token_minutes * 60,
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
