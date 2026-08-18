"""Access to verification tokens.

Looked up by digest rather than by owner, like sessions: the lookup is what establishes who
the token belongs to.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from syncaai.models import VerificationToken


class VerificationTokenRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_hash(self, token_hash: str) -> VerificationToken | None:
        return self._session.scalar(
            select(VerificationToken).where(VerificationToken.token_hash == token_hash)
        )

    def add(self, token: VerificationToken) -> None:
        self._session.add(token)
        self._session.flush()
