"""Mapping domain errors to HTTP responses.

One place, so the answer to "what does the API return when X happens" is read rather than
reconstructed. Services raise domain errors and never import ``HTTPException``.
"""

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from syncaai.errors import (
    AccountNotVerifiedError,
    AllowanceSpentError,
    BlockLengthOutOfRangeError,
    CannotReopenTaskError,
    ChecklistFullError,
    ChecklistItemNotFoundError,
    ChecklistOrderStaleError,
    HorizonTooLongError,
    InvalidCredentialsError,
    InvalidLinkTokenError,
    InvertedWindowError,
    NoDayToPlanError,
    NotAuthenticatedError,
    PlanCommitRaceError,
    PlanCommitRefusedError,
    PlanEmptyError,
    PlanFullError,
    PlanInProgressError,
    PlanItemNotFoundError,
    PlanJobNotFoundError,
    PlanningPausedError,
    PlanNotFoundError,
    PlanNotPendingError,
    PlanRateLimitedError,
    ProviderUnavailableError,
    RateLimitExceededError,
    StartCorrectionTooFarBackError,
    StepOverlapsStepError,
    StepOverlapsTaskError,
    StepStartsInThePastError,
    TaskNotFoundError,
    TaskOverlapsError,
    TaskStartsAfterCompletionError,
    TaskStartsInThePastError,
    UsableWindowInvertedError,
    UsableWindowTooLongError,
    UsableWindowTooShortError,
    WeekdayOutOfRangeError,
    WrongCurrentPasswordError,
)
from syncaai.planning.contract import MAX_ITEM_MINUTES, MAX_PLAN_ITEMS, MIN_ITEM_MINUTES
from syncaai.schemas.tasks import MAX_CHECKLIST_ITEMS
from syncaai.security.passwords import PasswordTooLongError
from syncaai.services.capacity import MAX_HORIZON_DAYS, MAX_USABLE_MINUTES, MIN_USABLE_MINUTES
from syncaai.services.plan_jobs import PLAN_IN_PROGRESS
from syncaai.services.tasks import START_CORRECTION_HOURS


def _hours(minutes: int) -> str:
    hours = minutes // 60
    return f"{hours} hour" if hours == 1 else f"{hours} hours"


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

    @app.exception_handler(WrongCurrentPasswordError)
    async def _wrong_current_password(_: Request, __: WrongCurrentPasswordError) -> JSONResponse:
        # 422, never 401: the client answers a 401 by renewing the session and, when that
        # does not help, by signing the person out, which a mistyped field must not do.
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "That is not your current password."},
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

    # Found before the handler above for this subclass: a handler is looked up along the
    # exception's own classes first.
    @app.exception_handler(PlanRateLimitedError)
    async def _plans_rate_limited(_: Request, error: PlanRateLimitedError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": f"At most {error.limit} plans {error.per}. Try again later."},
            headers={"Retry-After": str(error.retry_after_seconds)},
        )

    @app.exception_handler(AllowanceSpentError)
    async def _allowance_spent(_: Request, error: AllowanceSpentError) -> JSONResponse:
        # A limit on this person, like the rate limit, so the same status (ADR-0044).
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"detail": error.sentence},
            headers={"Retry-After": str(error.retry_after_seconds)},
        )

    @app.exception_handler(ProviderUnavailableError)
    async def _model_unavailable(_: Request, error: ProviderUnavailableError) -> JSONResponse:
        # The circuit breaker is open: nothing the person did, and over within a minute.
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": error.sentence},
            headers={"Retry-After": str(error.retry_after_seconds)},
        )

    @app.exception_handler(PlanningPausedError)
    async def _planning_paused(_: Request, error: PlanningPausedError) -> JSONResponse:
        # Nothing this person did: the service is unavailable to everyone until the month
        # turns, which is what 503 with Retry-After says (ADR-0006, ADR-0044).
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": error.sentence},
            headers={"Retry-After": str(error.retry_after_seconds)},
        )

    @app.exception_handler(UsableWindowInvertedError)
    async def _window_inverted(_: Request, __: UsableWindowInvertedError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "The usable day has to end after it starts, on the same day."},
        )

    @app.exception_handler(UsableWindowTooShortError)
    async def _window_too_short(_: Request, __: UsableWindowTooShortError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={
                "detail": f"The usable day has to be at least {_hours(MIN_USABLE_MINUTES)} long."
            },
        )

    @app.exception_handler(UsableWindowTooLongError)
    async def _window_too_long(_: Request, __: UsableWindowTooLongError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": f"The usable day can be at most {_hours(MAX_USABLE_MINUTES)} long."},
        )

    @app.exception_handler(WeekdayOutOfRangeError)
    async def _weekday_out_of_range(_: Request, __: WeekdayOutOfRangeError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "A weekday is a number from 1 (Monday) to 7 (Sunday)."},
        )

    @app.exception_handler(NoDayToPlanError)
    async def _no_day_to_plan(_: Request, __: NoDayToPlanError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "There has to be at least one day to plan in."},
        )

    @app.exception_handler(BlockLengthOutOfRangeError)
    async def _block_out_of_range(_: Request, __: BlockLengthOutOfRangeError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={
                "detail": f"A block lasts from {MIN_ITEM_MINUTES} minutes "
                f"to {_hours(MAX_ITEM_MINUTES)}."
            },
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

    @app.exception_handler(ChecklistItemNotFoundError)
    async def _item_missing(_: Request, __: ChecklistItemNotFoundError) -> JSONResponse:
        # Reached only once the task was found for this owner, so naming the item as the
        # missing thing says nothing about anybody else's checklist (ADR-0028).
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND, content={"detail": "No such checklist item."}
        )

    @app.exception_handler(ChecklistFullError)
    async def _checklist_full(_: Request, __: ChecklistFullError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": f"A task holds at most {MAX_CHECKLIST_ITEMS} checklist items."},
        )

    @app.exception_handler(ChecklistOrderStaleError)
    async def _order_stale(_: Request, __: ChecklistOrderStaleError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "The checklist changed since it was read. Read it again."},
        )

    @app.exception_handler(CannotReopenTaskError)
    async def _cannot_reopen(_: Request, __: CannotReopenTaskError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": "Something else took that time while this task was done.",
            },
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

    @app.exception_handler(StartCorrectionTooFarBackError)
    async def _correction_too_far_back(
        _: Request, __: StartCorrectionTooFarBackError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={
                "detail": f"A start can be corrected at most {START_CORRECTION_HOURS} hours back."
            },
        )

    @app.exception_handler(TaskStartsAfterCompletionError)
    async def _starts_after_completion(
        _: Request, __: TaskStartsAfterCompletionError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "A task cannot start after it was completed."},
        )

    @app.exception_handler(PasswordTooLongError)
    async def _password_too_long(_: Request, __: PasswordTooLongError) -> JSONResponse:
        # The request schema bounds this first, so reaching here means an internal caller
        # bypassed the boundary. Answered rather than left to become a 500.
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "Password is too long."},
        )

    @app.exception_handler(PlanInProgressError)
    async def _plan_in_progress(_: Request, __: PlanInProgressError) -> JSONResponse:
        # The same sentence the worker gives a job that loses this race (ADR-0033).
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT, content={"detail": PLAN_IN_PROGRESS}
        )

    @app.exception_handler(PlanJobNotFoundError)
    async def _plan_job_missing(_: Request, __: PlanJobNotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND, content={"detail": "No such plan request."}
        )

    @app.exception_handler(PlanNotFoundError)
    async def _plan_missing(_: Request, __: PlanNotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND, content={"detail": "No such plan."}
        )

    @app.exception_handler(PlanNotPendingError)
    async def _plan_not_pending(_: Request, __: PlanNotPendingError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "This plan is no longer open for review."},
        )

    @app.exception_handler(PlanItemNotFoundError)
    async def _plan_item_missing(_: Request, __: PlanItemNotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND, content={"detail": "No such step."}
        )

    @app.exception_handler(StepStartsInThePastError)
    async def _step_in_the_past(_: Request, __: StepStartsInThePastError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "A step cannot start in the past."},
        )

    @app.exception_handler(StepOverlapsTaskError)
    async def _step_overlaps_task(_: Request, __: StepOverlapsTaskError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "That time is already taken by a task."},
        )

    @app.exception_handler(StepOverlapsStepError)
    async def _step_overlaps_step(_: Request, __: StepOverlapsStepError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "That time is taken by another step of this plan."},
        )

    @app.exception_handler(PlanCommitRefusedError)
    async def _commit_refused(_: Request, error: PlanCommitRefusedError) -> JSONResponse:
        # Every step in the way, with what to change, so the review can show them all at once
        # rather than one per attempt (ADR-0030).
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": "The plan cannot become tasks as it stands. Nothing was written.",
                "items": [
                    {"id": item_id, "title": title, "reason": reason}
                    for item_id, title, reason in error.problems
                ],
            },
        )

    @app.exception_handler(PlanEmptyError)
    async def _plan_empty(_: Request, __: PlanEmptyError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "The plan has no steps to commit. Add one, or discard the plan."},
        )

    @app.exception_handler(PlanFullError)
    async def _plan_full(_: Request, __: PlanFullError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": f"A plan holds at most {MAX_PLAN_ITEMS} steps."},
        )

    @app.exception_handler(PlanCommitRaceError)
    async def _commit_race(_: Request, __: PlanCommitRaceError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "detail": "A task was booked on one of these times just now. "
                "Nothing was written; read the plan again."
            },
        )
