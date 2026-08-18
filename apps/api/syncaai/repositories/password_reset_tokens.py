"""Access to password reset tokens."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from syncaai.models import PasswordResetToken


class PasswordResetTokenRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_hash(self, token_hash: str) -> PasswordResetToken | None:
        return self._session.scalar(
            select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)
        )

    def add(self, token: PasswordResetToken) -> None:
        self._session.add(token)
        self._session.flush()
