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
