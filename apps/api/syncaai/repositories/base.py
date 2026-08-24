"""The owner-scoped repository base.

ADR-0002 named the most likely security failure of this project: user A reading
``/tasks/42``, which belongs to user B. It is likely because it needs nobody to do anything
clever — it happens when one query out of forty forgets a ``WHERE user_id = ...``, and
nothing about that query looks wrong in review.

So the filter does not live in the queries. It lives here, and **there is no method that
returns rows without it**. Forgetting the filter is not a mistake a caller can make, because
the unscoped query has no API.

Reaching the owner is declared per repository rather than assumed. A task carries
``user_id``; a checklist item deliberately does not (ADR-0010: a fact is stored once, in the
row that owns it), so its owner is reached by joining through ``tasks``. Both are expressed
the same way, and neither is special-cased in the code below.
"""

from collections.abc import Sequence
from typing import Any, ClassVar, Generic, TypeVar
from uuid import UUID

from sqlalchemy import ColumnElement, Select, select
from sqlalchemy.orm import Session

from syncaai.models import Base

ModelT = TypeVar("ModelT", bound=Base)


class OwnedRepository(Generic[ModelT]):
    """Access to rows that belong to somebody, scoped to one owner for its whole life.

    Subclasses declare three things and get every query filtered:

    - ``model`` — what is being read
    - ``owner_column`` — the column holding the owner's id, wherever it lives
    - ``owner_join`` — how to reach that column, when it is not on ``model`` itself

    A fourth is optional: ``default_order``, the sort a listing uses when the caller does not
    ask for one.
    """

    model: ClassVar[Any]
    owner_column: ClassVar[Any]
    owner_join: ClassVar[Any] = None

    # Empty means "order by primary key". Something has to be here: LIMIT/OFFSET over an
    # unordered result is undefined in PostgreSQL, and the practical shape of that is a
    # caller paging through a list and seeing one row twice while never seeing another.
    default_order: ClassVar[tuple[Any, ...]] = ()

    def __init__(self, session: Session, owner_id: UUID) -> None:
        self._session = session
        self._owner_id = owner_id

    @property
    def owner_id(self) -> UUID:
        """The owner every query here is scoped to.

        Exposed so a service can stamp a new row with it, rather than being handed the id
        separately and possibly a different one.
        """
        return self._owner_id

    def flush(self) -> None:
        """Send pending changes so the database can refuse them now rather than at commit."""
        self._session.flush()

    def _scoped(self) -> Select[tuple[ModelT]]:
        """Every read starts here. There is no variant of this without the filter."""
        declared = type(self)
        statement: Select[tuple[ModelT]] = select(declared.model)
        if declared.owner_join is not None:
            statement = statement.join(declared.owner_join)
        return statement.where(self._owner_clause())

    def _owner_clause(self) -> ColumnElement[bool]:
        # Read from the class, not the instance. ``owner_column`` holds a SQLAlchemy mapped
        # attribute, which is a descriptor: reaching it through an instance makes it try to
        # load a value from that instance's ORM state, and a repository has none.
        clause: ColumnElement[bool] = type(self).owner_column == self._owner_id
        return clause

    def get(self, entity_id: UUID) -> ModelT | None:
        """Return the entity if it belongs to this owner, otherwise None.

        None for "belongs to somebody else" is what lets the API answer 404 rather than 403
        (ADR-0016): the repository cannot tell the caller a row exists, because from here it
        does not.
        """
        return self._session.scalar(self._scoped().where(type(self).model.id == entity_id))

    def list(self, *, limit: int = 100, offset: int = 0) -> Sequence[ModelT]:
        """Return this owner's entities, a page at a time, in a defined order."""
        declared = type(self)
        order = declared.default_order or (declared.model.id,)
        statement = self._scoped().order_by(*order).limit(limit).offset(offset)
        return self._session.scalars(statement).all()

    def add(self, entity: ModelT) -> None:
        self._session.add(entity)
        self._session.flush()

    def delete(self, entity_id: UUID) -> bool:
        """Delete if it belongs to this owner. Returns whether anything was deleted.

        Goes through ``get`` rather than issuing a bare ``DELETE ... WHERE id = ...``, which
        would be the one place the owner filter could be forgotten without the type system
        noticing.
        """
        entity = self.get(entity_id)
        if entity is None:
            return False
        self._session.delete(entity)
        self._session.flush()
        return True
