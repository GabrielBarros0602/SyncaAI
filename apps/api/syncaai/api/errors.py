"""Mapping domain errors to HTTP responses.

One place, so the answer to "what does the API return when X happens" is read rather than
reconstructed. Services raise domain errors and never import ``HTTPException``.
"""

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from syncaai.errors import (
    AccountNotVerifiedError,
    HorizonTooLongError,
    InvalidCredentialsError,
    InvalidLinkTokenError,
    InvertedWindowError,
    NotAuthenticatedError,
    RateLimitExceededError,
    TaskNotFoundError,
    TaskOverlapsError,
    TaskStartsInThePastError,
)
from syncaai.security.passwords import PasswordTooLongError
from syncaai.services.capacity import MAX_HORIZON_DAYS


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AccountNotVerifiedError)
    async def _not_verified(_: Request, __: AccountNotVerifiedError) -> JSONResponse:
        # Reachable only with correct credentials, so saying why is safe and saying nothing
        # would strand a user who has no way to guess what is wrong.
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Confirm your address before signing in."},
        )

    @app.exception_handler(InvalidLinkTokenError)
    async def _bad_verification(_: Request, __: InvalidLinkTokenError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"detail": "That confirmation link is not valid. Request a new one."},
        )

    @app.exception_handler(NotAuthenticatedError)
    async def _not_authenticated(_: Request, __: NotAuthenticatedError) -> JSONResponse:
        # No token, an unreadable one, or a session that is gone. All three say the same
        # thing, and none of them says anything about any account.
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Not authenticated."},
            headers={"WWW-Authenticate": "Bearer"},
        )

    @app.exception_handler(InvalidCredentialsError)
    async def _bad_credentials(_: Request, __: InvalidCredentialsError) -> JSONResponse:
        # One message for a missing account and for a wrong password. The client cannot tell
        # which, which is the point. Reached only from the sign-in path — a request that
        # simply has no session gets NotAuthenticatedError above.
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Incorrect email or password."},
            headers={"WWW-Authenticate": "Bearer"},
        )

    @app.exception_handler(RateLimitExceededError)
    async def _rate_limited(_: Request, error: RateLimitExceededError) -> JSONResponse:
        # Retry-After tells an honest client exactly when to come back, which is cheaper
        # for everyone than it guessing. It tells an attacker nothing it could not measure.
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": "Too many attempts. Try again later."},
            headers={"Retry-After": str(error.retry_after_seconds)},
        )

    @app.exception_handler(InvertedWindowError)
    async def _inverted_window(_: Request, __: InvertedWindowError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "last_day cannot precede first_day."},
        )

    @app.exception_handler(HorizonTooLongError)
    async def _horizon_too_long(_: Request, __: HorizonTooLongError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": f"Ask for at most {MAX_HORIZON_DAYS} days at a time."},
        )

    @app.exception_handler(TaskNotFoundError)
    async def _task_missing(_: Request, __: TaskNotFoundError) -> JSONResponse:
        # 404 for "does not exist" and for "is not yours" alike. The repository cannot tell
        # them apart, which is the point (ADR-0016).
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND, content={"detail": "No such task."}
        )

    @app.exception_handler(TaskOverlapsError)
    async def _task_overlaps(_: Request, __: TaskOverlapsError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "That time is already taken by another task."},
        )

    @app.exception_handler(TaskStartsInThePastError)
    async def _task_in_the_past(_: Request, __: TaskStartsInThePastError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "A task cannot start in the past."},
        )

    @app.exception_handler(PasswordTooLongError)
    async def _password_too_long(_: Request, __: PasswordTooLongError) -> JSONResponse:
        # The request schema bounds this first, so reaching here means an internal caller
        # bypassed the boundary. Answered rather than left to become a 500.
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "Password is too long."},
        )
