"""Changing a password while signed in (ADR-0051)."""

import uuid
from datetime import datetime, timezone

from syncaai.errors import NotAuthenticatedError, WrongCurrentPasswordError
from syncaai.mail import Mailer, send_or_log
from syncaai.mail.messages import password_changed
from syncaai.repositories.refresh_tokens import RefreshTokenRepository
from syncaai.repositories.users import UserRepository
from syncaai.security.passwords import hash_password, verify_password
from syncaai.security.refresh import hash_refresh_token


class PasswordChangeService:
    def __init__(
        self, users: UserRepository, sessions: RefreshTokenRepository, mailer: Mailer
    ) -> None:
        self._users = users
        self._sessions = sessions
        self._mailer = mailer

    def change(
        self, user_id: uuid.UUID, current: str, new: str, *, this_session: str | None
    ) -> None:
        """Set ``new`` if ``current`` is right, keep ``this_session`` and end every other.

        ``this_session`` is the raw refresh token the request came with. It is kept only when
        it is one of this person's live sessions; anything else, or nothing, ends every
        session, so a change can end more than it meant to and never fewer (ADR-0051).
        """
        user = self._users.get_by_id(user_id)
        if user is None:
            raise NotAuthenticatedError
        if not verify_password(current, user.password_hash):
            raise WrongCurrentPasswordError

        user.password_hash = hash_password(new)
        self._sessions.revoke_all_for(user.id, keep=self._live_session(this_session))
        send_or_log(self._mailer, password_changed(user.email))

    def _live_session(self, raw: str | None) -> uuid.UUID | None:
        """The session ``raw`` names, while it is live. Somebody else's needs no check here:
        only this person's sessions are ended, so keeping another's changes nothing."""
        if raw is None:
            return None
        session = self._sessions.get_by_hash(hash_refresh_token(raw))
        if (
            session is None
            or session.revoked_at is not None
            or session.expires_at <= datetime.now(timezone.utc)
        ):
            return None
        return session.id
