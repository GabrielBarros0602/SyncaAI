"""Access to users.

Deliberately **not** owner-scoped, unlike the repositories S3 will add. Looking a user up
by email happens during login, before there is a current user to scope by — the owner does
not exist yet at that point. The base class described in ADR-0016 governs repositories for
resources that belong to somebody; this one governs the identity of the somebody.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from syncaai.models import User


class UserRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_by_email(self, email: str) -> User | None:
        """Return the user with this address, assuming it is already normalised.

        Normalisation belongs at the boundary, in the request schema, so that exactly one
        form of an address ever reaches the database or this query.
        """
        return self._session.scalar(select(User).where(User.email == email))

    def get_by_id(self, user_id: uuid.UUID) -> User | None:
        """Return the user with this id, or None.

        Not owner-scoped for the same reason as the lookup by email: this *establishes* who
        the owner is, so there is nothing to scope by yet.
        """
        return self._session.get(User, user_id)

    def add(self, user: User) -> None:
        self._session.add(user)
        self._session.flush()
