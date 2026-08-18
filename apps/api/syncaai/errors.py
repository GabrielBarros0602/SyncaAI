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


class InvalidVerificationTokenError(DomainError):
    """Raised for a verification token that is unknown, expired or already spent.

    One error for all three, so presenting a token cannot be used to learn which it was.
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
