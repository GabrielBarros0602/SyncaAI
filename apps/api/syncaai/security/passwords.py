"""Password hashing.

argon2id, per ADR-0014. The reason is memory-hardness: an attack on a leaked password
table runs on hardware that parallelises cheaply only while each guess needs little
memory, and requiring 64 MiB per guess removes that advantage.

The algorithm is confined to this module. Callers see two functions and a constant, so
replacing it later — or raising its cost — touches one file.
"""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# argon2 accepts any length, but a memory-hard function with unbounded input is an
# amplification vector: the caller chooses how much work the server does. 128 characters
# is well past any real passphrase.
MAX_PASSWORD_LENGTH = 128

# Library defaults: m=65536 (64 MiB), t=3, p=4. The parameters are written into the hash
# string, so raising them later leaves existing hashes verifiable.
_hasher = PasswordHasher()

# Hashed once at import, and only ever used as a decoy. See verify_dummy.
_DECOY_HASH = _hasher.hash("a password that authenticates nothing")


class PasswordTooLongError(ValueError):
    """Raised when a password exceeds what will be hashed."""


def hash_password(password: str) -> str:
    """Return a hash string carrying the algorithm and its parameters."""
    _reject_if_too_long(password)
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """Return whether the password matches the hash.

    Returns False rather than raising for a mismatch or an unreadable hash: a caller
    deciding whether to authenticate has the same answer in both cases, and distinguishing
    them invites leaking which happened.
    """
    _reject_if_too_long(password)
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def verify_dummy() -> None:
    """Spend the cost of a verification without authenticating anything.

    Called when the account does not exist. Without it, a login for an unknown address
    returns in microseconds while a login for a known one takes the full hashing time, and
    that difference is a reliable oracle for whether an email is registered. It is the same
    information that ADR-0016 refuses to give away through status codes, so giving it away
    through response timing would be pointless.
    """
    verify_password("a password that authenticates nothing", _DECOY_HASH)


def needs_rehash(password_hash: str) -> bool:
    """Return whether a hash was made with parameters weaker than the current ones.

    Lets a successful login transparently upgrade an old hash, so raising the cost does not
    require a password reset.
    """
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return False


def _reject_if_too_long(password: str) -> None:
    if len(password) > MAX_PASSWORD_LENGTH:
        message = f"password exceeds {MAX_PASSWORD_LENGTH} characters"
        raise PasswordTooLongError(message)
