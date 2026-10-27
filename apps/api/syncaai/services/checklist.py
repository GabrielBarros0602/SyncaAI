"""The rules a task's checklist has to obey (ADR-0028)."""

import uuid
from datetime import datetime, timezone

from syncaai.errors import (
    ChecklistFullError,
    ChecklistItemNotFoundError,
    ChecklistOrderStaleError,
    TaskNotFoundError,
)
from syncaai.models import ChecklistItem, Task
from syncaai.repositories.tasks import TaskRepository
from syncaai.schemas.tasks import MAX_CHECKLIST_ITEMS, ChecklistItemCreate, ChecklistItemUpdate


class ChecklistService:
    """Every item is reached through its task, and the task through its owner.

    That is the whole of the isolation here: an item id is only ever looked up among the
    items of a task this owner's repository already returned, so there is no path to an item
    that skips the owner filter.
    """

    def __init__(self, tasks: TaskRepository) -> None:
        self._tasks = tasks

    def add(self, task_id: uuid.UUID, payload: ChecklistItemCreate) -> ChecklistItem:
        task = self._task(task_id, lock=True)
        if len(task.items) >= MAX_CHECKLIST_ITEMS:
            raise ChecklistFullError
        item = ChecklistItem(label=payload.label, position=len(task.items))
        task.items.append(item)
        self._tasks.flush()
        return item

    def update(
        self, task_id: uuid.UUID, item_id: uuid.UUID, payload: ChecklistItemUpdate
    ) -> ChecklistItem:
        item = self._item(self._task(task_id), item_id)
        if payload.label is not None:
            item.label = payload.label
        if payload.completed is not None:
            # A moment rather than a flag, as for a task: when it was ticked is the data.
            item.completed_at = datetime.now(timezone.utc) if payload.completed else None
        self._tasks.flush()
        return item

    def delete(self, task_id: uuid.UUID, item_id: uuid.UUID) -> None:
        task = self._task(task_id, lock=True)
        task.items.remove(self._item(task, item_id))
        # Close the gap, so a position keeps meaning "the n-th item". The rows after it
        # collide with each other for a moment; the deferred unique check waits for commit.
        for position, item in enumerate(task.items):
            item.position = position
        self._tasks.flush()

    def reorder(self, task_id: uuid.UUID, item_ids: list[uuid.UUID]) -> list[ChecklistItem]:
        task = self._task(task_id, lock=True)
        current = {item.id: item for item in task.items}
        # Exactly the current items, each once. The length check is what catches a
        # duplicate: a list naming one item twice can still have the right set of ids.
        if len(item_ids) != len(current) or set(item_ids) != set(current):
            raise ChecklistOrderStaleError
        for position, item_id in enumerate(item_ids):
            current[item_id].position = position
        self._tasks.flush()
        return [current[item_id] for item_id in item_ids]

    def _task(self, task_id: uuid.UUID, *, lock: bool = False) -> Task:
        """``lock`` for every change that numbers the items. A position is read from the
        items there are, and two changes reading at once would both write the same one: the
        deferred unique check would refuse the second only at commit, as a server error."""
        task = (self._tasks.get_for_change if lock else self._tasks.get_with_items)(task_id)
        if task is None:
            raise TaskNotFoundError
        return task

    @staticmethod
    def _item(task: Task, item_id: uuid.UUID) -> ChecklistItem:
        for item in task.items:
            if item.id == item_id:
                return item
        raise ChecklistItemNotFoundError
