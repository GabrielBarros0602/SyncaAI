"""Registration and authentication."""

from datetime import datetime, timedelta, timezone

from syncaai.config import get_settings
from syncaai.errors import EmailAlreadyRegisteredError, InvalidCredentialsError
from syncaai.models import RefreshToken, User
from syncaai.repositories.refresh_tokens import RefreshTokenRepository
from syncaai.repositories.users import UserRepository
from syncaai.security.passwords import hash_password, needs_rehash, verify_dummy, verify_password
from syncaai.security.refresh import generate_refresh_token, hash_refresh_token


class AuthService:
    def __init__(self, users: UserRepository, sessions: RefreshTokenRepository) -> None:
        self._users = users
        self._sessions = sessions

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

    def issue_refresh_token(self, user: User) -> str:
        """Create a session and return its raw token.

        The raw value exists only here and in the response. Everything afterwards works from
        the digest, so a database leak yields no usable session.
        """
        raw = generate_refresh_token()
        expires_at = datetime.now(timezone.utc) + timedelta(days=get_settings().refresh_token_days)
        self._sessions.add(
            RefreshToken(user_id=user.id, token_hash=hash_refresh_token(raw), expires_at=expires_at)
        )
        return raw

    def exchange_refresh_token(self, raw: str) -> User:
        """Return the user a live session belongs to, or raise.

        Unknown, expired and revoked all raise the same error, so the response cannot be used
        to work out which of the three a presented token is. A caller with a valid token does
        not need the distinction, and a caller without one should not get it.
        """
        session = self._sessions.get_by_hash(hash_refresh_token(raw))
        if session is None or session.revoked_at is not None:
            raise InvalidCredentialsError
        if session.expires_at <= datetime.now(timezone.utc):
            raise InvalidCredentialsError
        return session.user

    def revoke_refresh_token(self, raw: str) -> None:
        """End a session. Silent when the token is unknown or already revoked.

        Logging out answers the same way regardless, so it reveals nothing about whether the
        token presented was ever real.
        """
        session = self._sessions.get_by_hash(hash_refresh_token(raw))
        if session is not None and session.revoked_at is None:
            session.revoked_at = datetime.now(timezone.utc)
