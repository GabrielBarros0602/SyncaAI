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


class TaskNotFoundError(DomainError):
    """Raised for a task that does not exist, or belongs to somebody else.

    One error for both. The repository cannot tell the two apart, which is exactly what lets
    the API answer 404 rather than confirming a resource exists (ADR-0016).
    """


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
