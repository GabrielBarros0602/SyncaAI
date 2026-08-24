"""Registration and authentication."""

from datetime import datetime, timedelta, timezone

from syncaai.config import Settings
from syncaai.errors import (
    AccountNotVerifiedError,
    InvalidCredentialsError,
    NotAuthenticatedError,
)
from syncaai.models import RefreshToken, User
from syncaai.repositories.refresh_tokens import RefreshTokenRepository
from syncaai.repositories.users import UserRepository
from syncaai.security.passwords import hash_password, needs_rehash, verify_dummy, verify_password
from syncaai.security.refresh import generate_refresh_token, hash_refresh_token


class AuthService:
    def __init__(
        self, users: UserRepository, sessions: RefreshTokenRepository, settings: Settings
    ) -> None:
        self._users = users
        self._sessions = sessions
        self._settings = settings

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

        # Checked only after the password matched. A caller who got this far already knows
        # the account exists, so naming the reason discloses nothing (ADR-0019).
        if user.verified_at is None:
            raise AccountNotVerifiedError

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
        expires_at = datetime.now(timezone.utc) + timedelta(days=self._settings.refresh_token_days)
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
            raise NotAuthenticatedError
        if session.expires_at <= datetime.now(timezone.utc):
            raise NotAuthenticatedError
        return session.user

    def revoke_refresh_token(self, raw: str) -> None:
        """End a session. Silent when the token is unknown or already revoked.

        Logging out answers the same way regardless, so it reveals nothing about whether the
        token presented was ever real.
        """
        session = self._sessions.get_by_hash(hash_refresh_token(raw))
        if session is not None and session.revoked_at is None:
            session.revoked_at = datetime.now(timezone.utc)
