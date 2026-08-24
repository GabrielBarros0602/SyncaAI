"""Task endpoints.

Every one of these takes the owner from the token and never from the payload. That is what
makes the isolation ADR-0016 designed actually reachable — an id in a path is narrowed by
the owner filter, never trusted on its own.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from syncaai.api.dependencies import CurrentUserId
from syncaai.db import get_session
from syncaai.repositories.tags import TagRepository
from syncaai.repositories.tasks import TaskRepository
from syncaai.schemas.tasks import Page, TagRead, TaskCreate, TaskRead, TaskUpdate
from syncaai.services.tasks import MAX_PAGE_SIZE, TaskService

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


@router.get("/tasks", summary="List your tasks, soonest first")
def list_tasks(
    service: ServiceDep,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page:
    tasks = service.list(limit=limit, offset=offset)
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
