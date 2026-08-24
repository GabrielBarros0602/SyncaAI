"""Repositories for tasks and their checklist items.

Between them these two cover both ways of reaching an owner, which is the whole reason the
base takes a join rather than assuming a column.
"""

import uuid
from collections.abc import Sequence

from sqlalchemy.orm import selectinload

from syncaai.models import ChecklistItem, Task
from syncaai.repositories.base import OwnedRepository


class TaskRepository(OwnedRepository[Task]):
    """The owner is on the row."""

    model = Task
    owner_column = Task.user_id
    # Soonest first, then id to break a tie. Two tasks cannot share a start for one owner,
    # but the tiebreak costs nothing and the ordering stops depending on that being true.
    default_order = (Task.start_at, Task.id)

    def get_with_items(self, task_id: "uuid.UUID") -> Task | None:
        """Fetch a task and everything a response needs, in two queries rather than many.

        Without the eager load, serialising a page of tasks issues one query per task for
        its items and another for its tag. That is the N+1 that ORMs are famous for, and it
        is invisible until a list has more than a handful of rows.
        """
        statement = (
            self._scoped()
            .where(Task.id == task_id)
            .options(selectinload(Task.items), selectinload(Task.tag))
        )
        return self._session.scalar(statement)

    def list_with_items(self, *, limit: int = 50, offset: int = 0) -> Sequence[Task]:
        """A page of this owner's tasks, soonest first."""
        statement = (
            self._scoped()
            .options(selectinload(Task.items), selectinload(Task.tag))
            .order_by(Task.start_at, Task.id)
            .limit(limit)
            .offset(offset)
        )
        return self._session.scalars(statement).all()


class ChecklistItemRepository(OwnedRepository[ChecklistItem]):
    """The owner is on the parent task, so reaching it is a join.

    ``ChecklistItem`` has no ``user_id`` on purpose (ADR-0010). Adding one to make this
    simpler would store the same fact twice, and the two copies could disagree the moment an
    item moved between tasks.
    """

    model = ChecklistItem
    owner_join = Task
    owner_column = Task.user_id
