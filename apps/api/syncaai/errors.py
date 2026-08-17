"""Domain errors.

Raised by services, mapped to HTTP responses in one place — ``syncaai.api.errors``. No
service imports ``HTTPException``: a service that knows status codes cannot be reused
outside HTTP, and the mapping stops being auditable once it is scattered across handlers.
"""


class DomainError(Exception):
    """Base for a violated rule of the domain, as opposed to a failure of the process."""


class EmailAlreadyRegisteredError(DomainError):
    """Raised when registration is attempted with an address that already has an account."""


class InvalidCredentialsError(DomainError):
    """Raised when authentication fails.

    Deliberately one error for both "no such account" and "wrong password". The caller has
    the same decision to make, and distinguishing them is exactly the account enumeration
    that ``verify_dummy`` spends time to prevent.
    """
