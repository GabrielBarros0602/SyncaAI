"""The rules a task has to obey."""

import uuid
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError

from syncaai.errors import TaskNotFoundError, TaskOverlapsError, TaskStartsInThePastError
from syncaai.models import ChecklistItem, Tag, Task
from syncaai.repositories.tags import TagRepository
from syncaai.repositories.tasks import TaskRepository
from syncaai.schemas.tasks import TaskCreate, TaskUpdate

OVERLAP_CONSTRAINT = "ex_tasks_no_overlap_per_user"

# A caller that asks for everything is a caller that gets one page. The ceiling exists so a
# listing cannot be turned into a way to make the server assemble unbounded work.
MAX_PAGE_SIZE = 100


@contextmanager
def _overlap_translated() -> Iterator[None]:
    """Turn the database's refusal into a rule the caller broke.

    The constraint name comes from the driver's diagnostics rather than from matching the
    message text, so a change of wording or locale cannot silently turn a known conflict
    back into a 500. Anything else propagates untouched — swallowing an unexpected
    IntegrityError here would hide a real defect behind a friendly error.
    """
    try:
        yield
    except IntegrityError as error:
        diagnostics = getattr(error.orig, "diag", None)
        if getattr(diagnostics, "constraint_name", None) == OVERLAP_CONSTRAINT:
            raise TaskOverlapsError from error
        raise


class TaskService:
    def __init__(self, tasks: TaskRepository, tags: TagRepository) -> None:
        self._tasks = tasks
        self._tags = tags

    def create(self, payload: TaskCreate) -> Task:
        self._refuse_the_past(payload.start_at)

        task = Task(
            user_id=self._tasks.owner_id,
            title=payload.title,
            notes=payload.notes,
            start_at=payload.start_at,
            duration_minutes=payload.duration_minutes,
            tag_id=self._tag_id(payload.tag),
        )
        task.items = [
            ChecklistItem(label=item.label, position=position)
            for position, item in enumerate(payload.items)
        ]

        with _overlap_translated():
            self._tasks.add(task)
        return task

    def update(self, task_id: uuid.UUID, payload: TaskUpdate) -> Task:
        task = self._tasks.get_with_items(task_id)
        if task is None:
            raise TaskNotFoundError

        # Which fields arrived, rather than which are non-null. The two nullable columns
        # accept an explicit null as "clear this", and only this set can tell that apart
        # from a field the client never mentioned.
        provided = payload.model_fields_set

        if payload.start_at is not None:
            self._refuse_the_past(payload.start_at)
            task.start_at = payload.start_at
        if payload.title is not None:
            task.title = payload.title
        if payload.duration_minutes is not None:
            task.duration_minutes = payload.duration_minutes
        if "notes" in provided:
            task.notes = payload.notes
        if "tag" in provided:
            task.tag_id = self._tag_id(payload.tag)
        if payload.completed is not None:
            # A timestamp rather than a flag: the heatmap needs to know when, not only that.
            task.completed_at = datetime.now(timezone.utc) if payload.completed else None

        with _overlap_translated():
            self._tasks.flush()
        return task

    def get(self, task_id: uuid.UUID) -> Task:
        task = self._tasks.get_with_items(task_id)
        if task is None:
            raise TaskNotFoundError
        return task

    def list(self, *, limit: int, offset: int) -> Sequence[Task]:
        return self._tasks.list_with_items(limit=min(limit, MAX_PAGE_SIZE), offset=offset)

    def list_tags(self, *, limit: int) -> Sequence[Tag]:
        return self._tags.list(limit=min(limit, MAX_PAGE_SIZE))

    def delete(self, task_id: uuid.UUID) -> None:
        if not self._tasks.delete(task_id):
            raise TaskNotFoundError

    def _tag_id(self, name: str | None) -> uuid.UUID | None:
        return self._tags.get_or_create(name).id if name else None

    @staticmethod
    def _refuse_the_past(start_at: datetime) -> None:
        if start_at <= datetime.now(timezone.utc):
            raise TaskStartsInThePastError
