"""Repositories for tasks and their checklist items.

Declarations only for now: the domain methods arrive in S4 with the endpoints that need
them. What exists here is the scoping, which had to exist before those endpoints do — that
is why the sprint order was changed to put authentication first.

Between them these two cover both ways of reaching an owner, which is the whole reason the
base takes a join rather than assuming a column.
"""

from syncaai.models import ChecklistItem, Task
from syncaai.repositories.base import OwnedRepository


class TaskRepository(OwnedRepository[Task]):
    """The owner is on the row."""

    model = Task
    owner_column = Task.user_id


class ChecklistItemRepository(OwnedRepository[ChecklistItem]):
    """The owner is on the parent task, so reaching it is a join.

    ``ChecklistItem`` has no ``user_id`` on purpose (ADR-0010). Adding one to make this
    simpler would store the same fact twice, and the two copies could disagree the moment an
    item moved between tasks.
    """

    model = ChecklistItem
    owner_join = Task
    owner_column = Task.user_id
