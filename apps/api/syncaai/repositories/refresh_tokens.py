"""Access to sessions.

Looked up by digest rather than by owner, because the owner is what the lookup establishes —
the same reason ``UserRepository`` is not owner-scoped either.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from syncaai.models import RefreshToken


class RefreshTokenRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_hash(self, token_hash: str) -> RefreshToken | None:
        return self._session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )

    def revoke_all_for(self, user_id: uuid.UUID) -> None:
        """End every session this user has open.

        Called when the password changes. Without it, whoever knew the old password keeps a
        live session for up to thirty days, and the reset would have secured nothing.
        """
        self._session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(timezone.utc))
        )

    def add(self, token: RefreshToken) -> None:
        self._session.add(token)
        self._session.flush()
