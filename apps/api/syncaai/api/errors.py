"""Mapping domain errors to HTTP responses.

One place, so the answer to "what does the API return when X happens" is read rather than
reconstructed. Services raise domain errors and never import ``HTTPException``.
"""

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from syncaai.errors import EmailAlreadyRegisteredError, InvalidCredentialsError
from syncaai.security.passwords import PasswordTooLongError


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(EmailAlreadyRegisteredError)
    async def _email_taken(_: Request, __: EmailAlreadyRegisteredError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "That address already has an account."},
        )

    @app.exception_handler(InvalidCredentialsError)
    async def _bad_credentials(_: Request, __: InvalidCredentialsError) -> JSONResponse:
        # One message for a missing account and for a wrong password. The client cannot tell
        # which, which is the point.
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Incorrect email or password."},
            headers={"WWW-Authenticate": "Bearer"},
        )

    @app.exception_handler(PasswordTooLongError)
    async def _password_too_long(_: Request, __: PasswordTooLongError) -> JSONResponse:
        # The request schema bounds this first, so reaching here means an internal caller
        # bypassed the boundary. Answered rather than left to become a 500.
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": "Password is too long."},
        )
