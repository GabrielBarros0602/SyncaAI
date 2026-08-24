"""Task endpoints.

Every one of these takes the owner from the token and never from the payload. That is what
makes the isolation ADR-0016 designed actually reachable — an id in a path is narrowed by
the owner filter, never trusted on its own.
"""

import uuid
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.exceptions import RequestValidationError
from sqlalchemy.orm import Session

from syncaai.api.dependencies import CurrentUser, CurrentUserId
from syncaai.db import get_session
from syncaai.errors import HorizonTooLongError, InvertedWindowError
from syncaai.repositories.tags import TagRepository
from syncaai.repositories.tasks import TaskRepository
from syncaai.schemas.tasks import Page, TagRead, TaskCreate, TaskRead, TaskUpdate
from syncaai.services.capacity import MAX_HORIZON_DAYS
from syncaai.services.tasks import MAX_PAGE_SIZE, TaskService
from syncaai.time_windows import utc_window

router = APIRouter(tags=["tasks"])

SessionDep = Annotated[Session, Depends(get_session)]


def get_task_service(session: SessionDep, user_id: CurrentUserId) -> TaskService:
    return TaskService(TaskRepository(session, user_id), TagRepository(session, user_id))


ServiceDep = Annotated[TaskService, Depends(get_task_service)]


@router.post("/tasks", status_code=status.HTTP_201_CREATED, summary="Schedule a task")
def create_task(payload: TaskCreate, service: ServiceDep, session: SessionDep) -> TaskRead:
    task = service.create(payload)
    session.commit()
    return TaskRead.model_validate(task)


def _window_for(
    user: CurrentUser, first_day: date | None, last_day: date | None
) -> tuple[datetime, datetime] | None:
    """Turn a pair of local days into the UTC range they cover.

    Both or neither. One alone is almost certainly a bug in the caller — an open-ended range
    that looks like a filter — and answering it as if it were intentional would hide that
    for as long as the data happened to be small.
    """
    if first_day is None and last_day is None:
        return None
    if first_day is None or last_day is None:
        message = "first_day and last_day are given together or not at all"
        raise RequestValidationError([{"loc": ("query", "first_day"), "msg": message}])
    if last_day < first_day:
        raise InvertedWindowError
    if (last_day - first_day).days + 1 > MAX_HORIZON_DAYS:
        raise HorizonTooLongError

    # Same conversion, same helper and same zone as the capacity endpoint. Two screens
    # asking about "this week" have to agree on which instants that is.
    return utc_window(first_day, last_day, user.timezone)


@router.get("/tasks", summary="List your tasks, soonest first")
def list_tasks(
    service: ServiceDep,
    user: CurrentUser,
    first_day: Annotated[date | None, Query(description="First local day, inclusive.")] = None,
    last_day: Annotated[date | None, Query(description="Last local day, inclusive.")] = None,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page:
    """Optionally narrowed to a window of local days.

    The dates are the same vocabulary as ``/capacity``, on purpose: a week view asks both
    for the same seven days and gets answers that line up.
    """
    window = _window_for(user, first_day, last_day)
    tasks = service.list(limit=limit, offset=offset, window=window)
    return Page(items=[TaskRead.model_validate(task) for task in tasks], limit=limit, offset=offset)


@router.get("/tasks/{task_id}", summary="Read one task")
def read_task(task_id: uuid.UUID, service: ServiceDep) -> TaskRead:
    return TaskRead.model_validate(service.get(task_id))


@router.patch("/tasks/{task_id}", summary="Change a task")
def update_task(
    task_id: uuid.UUID, payload: TaskUpdate, service: ServiceDep, session: SessionDep
) -> TaskRead:
    task = service.update(task_id, payload)
    session.commit()
    return TaskRead.model_validate(task)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a task")
def delete_task(task_id: uuid.UUID, service: ServiceDep, session: SessionDep) -> None:
    service.delete(task_id)
    session.commit()


@router.get("/tags", summary="List the tags you have used")
def list_tags(
    service: ServiceDep, limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 100
) -> list[TagRead]:
    """Read-only on purpose. A tag exists because a task named it (ADR-0020)."""
    return [TagRead.model_validate(tag) for tag in service.list_tags(limit=limit)]
