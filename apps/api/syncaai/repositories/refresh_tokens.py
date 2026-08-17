"""Access to sessions.

Looked up by digest rather than by owner, because the owner is what the lookup establishes —
the same reason ``UserRepository`` is not owner-scoped either.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from syncaai.models import RefreshToken


class RefreshTokenRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_hash(self, token_hash: str) -> RefreshToken | None:
        return self._session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        )

    def add(self, token: RefreshToken) -> None:
        self._session.add(token)
        self._session.flush()
