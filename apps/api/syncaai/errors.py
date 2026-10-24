"""Domain errors.

Raised by services, mapped to HTTP responses in one place — ``syncaai.api.errors``. No
service imports ``HTTPException``: a service that knows status codes cannot be reused
outside HTTP, and the mapping stops being auditable once it is scattered across handlers.
"""


class DomainError(Exception):
    """Base for a violated rule of the domain, as opposed to a failure of the process."""


class AccountNotVerifiedError(DomainError):
    """Raised when correct credentials belong to an account whose address is unproven.

    Only reachable after authentication succeeds, so it discloses nothing: a caller holding
    the right password already knows the account exists (ADR-0019).
    """


class InvalidLinkTokenError(DomainError):
    """Raised for a token from a mailed link that is unknown, expired or already spent.

    Covers confirmation and password reset alike: both arrive the same way, fail the same
    way, and answer the same way. Naming it after only one of them sent whoever debugged a
    reset failure looking in the wrong place.

    One error for all three conditions, so presenting a token cannot be used to learn which
    of them it hit.
    """


class InvalidCredentialsError(DomainError):
    """Raised when authentication fails.

    Deliberately one error for both "no such account" and "wrong password". The caller has
    the same decision to make, and distinguishing them is exactly the account enumeration
    that ``verify_dummy`` spends time to prevent.
    """


class RateLimitExceededError(DomainError):
    """Raised when a caller has spent its allowance for the current window."""

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__(retry_after_seconds)
        self.retry_after_seconds = retry_after_seconds


class CeilingReachedError(DomainError):
    """Raised when a month's spend has reached a ceiling (ADR-0006, ADR-0044).

    Carries the sentence a person reads, because the same refusal reaches them two ways: as
    the answer to a request, and as the reason a queued job failed.
    """

    sentence: str

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__(retry_after_seconds)
        self.retry_after_seconds = retry_after_seconds


class AllowanceSpentError(CeilingReachedError):
    """A person's month has reached their ceiling."""

    sentence = "This month's plans are used up. They renew on the first of next month."


class PlanningPausedError(CeilingReachedError):
    """Everyone's month has reached the global ceiling: the kill switch."""

    sentence = "Planning is paused until next month."


class ProviderUnavailableError(DomainError):
    """Raised while the circuit breaker is open: the model's latest calls failed (ADR-0046)."""

    sentence = "Planning is unavailable right now. Try again in a minute."

    def __init__(self, retry_after_seconds: int) -> None:
        super().__init__(retry_after_seconds)
        self.retry_after_seconds = retry_after_seconds


class PlanRateLimitedError(RateLimitExceededError):
    """Raised when a person has had as many plans as a window allows (ADR-0042).

    Its own class so the answer can say which limit, in a sentence a person reads, where the
    sign-in's limit says only to try later.
    """

    def __init__(self, retry_after_seconds: int, *, limit: int, per: str) -> None:
        super().__init__(retry_after_seconds)
        self.limit = limit
        self.per = per


class TaskOverlapsError(DomainError):
    """Raised when a task would occupy time another already occupies.

    The database refuses this through an exclusion constraint (ADR-0008), which is what
    makes the guarantee absolute. This exists so the refusal reaches the caller as a rule
    they broke rather than as a driver exception.
    """


class TaskStartsInThePastError(DomainError):
    """Raised when a task would be scheduled before now.

    A service rule rather than a CHECK, because ``now()`` is not IMMUTABLE and cannot appear
    in one (ADR-0012). Recording something that already happened is a different feature and
    does not exist.
    """


class StartCorrectionTooFarBackError(DomainError):
    """Raised when a started task's start would move back further than the correction allows.

    A task that has begun may have its start corrected, because a plan and the day it
    describes rarely agree to the minute — but only within a day of now (ADR-0027). Further
    back it stops being a correction and becomes the retroactive logging ADR-0012 declined.
    """


class TaskStartsAfterCompletionError(DomainError):
    """Raised when a correction would put a completed task's start after its completion.

    The trigger would accept it and record an empty occupancy (ADR-0022), so the database
    cannot be the one to refuse. A correction exists to make the record true, and "it began
    after it ended" never is (ADR-0027).
    """


class TaskNotFoundError(DomainError):
    """Raised for a task that does not exist, or belongs to somebody else.

    One error for both. The repository cannot tell the two apart, which is exactly what lets
    the API answer 404 rather than confirming a resource exists (ADR-0016).
    """


class ChecklistItemNotFoundError(DomainError):
    """Raised for an item that is not on the task named in the path.

    Separate from :class:`TaskNotFoundError` only for the sentence. The task has already
    been found for this owner, so saying the item is missing discloses nothing about anybody
    else's checklist (ADR-0028).
    """


class ChecklistFullError(DomainError):
    """Raised when adding an item to a task that already holds the most a checklist may."""


class ChecklistOrderStaleError(DomainError):
    """Raised when a new order does not name exactly the items the task has.

    An item added or removed since the client read the list. Merging the two would produce an
    order nobody chose, so the client is told to read again instead (ADR-0028).
    """


class UsableWindowInvertedError(DomainError):
    """Raised when a usable day would end before it starts, or at the same moment.

    The window does not cross midnight (ADR-0029): an end earlier than the start is not the
    next morning, it is a window the account cannot have.
    """


class UsableWindowTooShortError(DomainError):
    """Raised when a usable day would be shorter than the floor ADR-0023 set."""


class UsableWindowTooLongError(DomainError):
    """Raised when a usable day would pass the ceiling ADR-0023 set.

    The ceiling is what keeps the load ladder from inverting: past eighteen hours a day is
    called extreme whatever the budget says, so no budget may reach past it.
    """


class WeekdayOutOfRangeError(DomainError):
    """Raised for a day off that is not an ISO weekday, 1 (Monday) to 7 (Sunday)."""


class NoDayToPlanError(DomainError):
    """Raised when days off would cover the whole week.

    A planner with no day to place anything in can never answer, so this is refused as a
    setting rather than discovered later as a plan that is all unplaced (ADR-0032).
    """


class BlockLengthOutOfRangeError(DomainError):
    """Raised for a preferred block outside the bounds a planned step has (ADR-0030)."""


class InvertedWindowError(DomainError):
    """Raised when a capacity window ends before it starts."""


class HorizonTooLongError(DomainError):
    """Raised when a caller asks for more days than the service will assemble at once."""


class NotAuthenticatedError(DomainError):
    """Raised when a request carries no usable session.

    Separate from :class:`InvalidCredentialsError` for one reason: the message. Both answer
    401 and both stay generic, but "Incorrect email or password" is a sentence about a form
    the caller did not submit. A user whose token expired while the tab was open would read
    it as a claim their password is wrong.

    The distinction is not an information leak. This says only "you are not signed in",
    which is already obvious to whoever sent no token.
    """


class CannotReopenTaskError(DomainError):
    """Raised when un-completing a task would collide with something booked meanwhile.

    New with ADR-0022. Completing early gives the remaining time back, and something else can
    take it; marking the task unfinished tries to grow its range into that time, and the
    exclusion constraint refuses. Correct, and it needs a sentence rather than a driver error.
    """


class PlanInProgressError(DomainError):
    """Raised when a person asks for a plan while another is still being made (ADR-0033).

    Recognised by the partial unique index's name, as an overlap is by the exclusion
    constraint's: a double submit loses the race at the index, and this is what it is told.
    """


class PlanJobNotFoundError(DomainError):
    """Raised for a plan request that does not exist, or belongs to somebody else (ADR-0016)."""


class PlanNotFoundError(DomainError):
    """Raised for a plan that does not exist, or belongs to somebody else (ADR-0016)."""


class PlanNotPendingError(DomainError):
    """Raised when a plan that was approved, discarded or has expired is changed (ADR-0038)."""


class PlanItemNotFoundError(DomainError):
    """Raised for a step that is not in the plan named, which may be somebody else's."""


class StepStartsInThePastError(DomainError):
    """Raised when a step is moved to a start that has passed, as a task would be (ADR-0030)."""


class StepOverlapsTaskError(DomainError):
    """Raised when a step is moved onto time a task already holds (ADR-0030)."""


class StepOverlapsStepError(DomainError):
    """Raised when a step is moved onto time another step of the same plan holds (ADR-0030)."""


class PlanCommitRefusedError(DomainError):
    """Raised when a plan cannot become tasks as it stands. Nothing is written (ADR-0030).

    Carries each step that stands in the way and why, so the review can show what to change.
    """

    def __init__(self, problems: list[tuple[str, str, str]]) -> None:
        super().__init__()
        #: (step id, step title, reason), in the plan's order.
        self.problems = problems


class PlanFullError(DomainError):
    """Raised when a step is added to a plan that holds as many as a plan may (ADR-0047)."""


class PlanEmptyError(DomainError):
    """Raised when a plan with no step is committed: every one removed, or a plan written by
    hand before any was added (ADR-0030, ADR-0047)."""


class PlanCommitRaceError(DomainError):
    """Raised when a task is booked on a step's time between the commit's check and its
    insert. The exclusion constraint has the final word, and nothing is written."""
