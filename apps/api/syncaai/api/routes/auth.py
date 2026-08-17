"""Registration and login endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from syncaai.config import get_settings
from syncaai.db import get_session
from syncaai.repositories.users import UserRepository
from syncaai.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserRead
from syncaai.security.tokens import create_access_token
from syncaai.services.auth import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


def get_auth_service(session: Annotated[Session, Depends(get_session)]) -> AuthService:
    return AuthService(UserRepository(session))


ServiceDep = Annotated[AuthService, Depends(get_auth_service)]
SessionDep = Annotated[Session, Depends(get_session)]


@router.post("/register", status_code=status.HTTP_201_CREATED, summary="Create an account")
def register(payload: RegisterRequest, service: ServiceDep, session: SessionDep) -> UserRead:
    """Create an account and return it.

    No token is issued here. Registration is the rare path and minting credentials in two
    places doubles what has to be audited; the client logs in afterwards.
    """
    user = service.register(payload.email, payload.password, payload.timezone)
    session.commit()
    return UserRead.model_validate(user)


@router.post("/login", summary="Exchange credentials for an access token")
def login(payload: LoginRequest, service: ServiceDep, session: SessionDep) -> TokenResponse:
    user = service.authenticate(payload.email, payload.password)
    # A successful login may have upgraded the stored hash.
    session.commit()

    settings = get_settings()
    return TokenResponse(
        access_token=create_access_token(user.id),
        expires_in=settings.access_token_minutes * 60,
    )
