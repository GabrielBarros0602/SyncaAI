"""Registration and authentication."""

from syncaai.errors import EmailAlreadyRegisteredError, InvalidCredentialsError
from syncaai.models import User
from syncaai.repositories.users import UserRepository
from syncaai.security.passwords import hash_password, needs_rehash, verify_dummy, verify_password


class AuthService:
    def __init__(self, users: UserRepository) -> None:
        self._users = users

    def register(self, email: str, password: str, timezone: str) -> User:
        """Create an account.

        Rejecting a duplicate address tells the caller that the address has an account,
        which is the enumeration that login goes out of its way to prevent. Closing that
        hole properly requires accepting the registration and sending a verification mail,
        which this project cannot do yet. The leak is accepted and recorded rather than
        hidden behind a vague message that would confuse a legitimate user without stopping
        an attacker.
        """
        if self._users.get_by_email(email) is not None:
            raise EmailAlreadyRegisteredError(email)

        user = User(email=email, password_hash=hash_password(password), timezone=timezone)
        self._users.add(user)
        return user

    def authenticate(self, email: str, password: str) -> User:
        """Return the user these credentials identify, or raise.

        When no account exists, a hash is still computed. Returning early would answer in
        microseconds while a real account takes the full argon2 cost, and that difference is
        a reliable test for whether an address is registered.
        """
        user = self._users.get_by_email(email)
        if user is None:
            verify_dummy()
            raise InvalidCredentialsError

        if not verify_password(password, user.password_hash):
            raise InvalidCredentialsError

        # A successful login is the only moment the plain password is available, so it is
        # the only moment an old hash can be upgraded without asking for a reset.
        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)

        return user
