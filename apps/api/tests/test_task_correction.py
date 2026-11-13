"""A started task's start, corrected against PostgreSQL itself (ADR-0027).

The edges of the correction window are tested in ``test_task_endpoints`` with the repositories
substituted. That proves the rule, and nothing about what reaches the table. Here the request
goes through the real route, service, repository and session, and the row is read back in a
session of its own: an accepted correction has to be committed, with ``end_at`` derived again by
the trigger from the corrected start, and a refused one has to leave the row as it was.

The endpoint commits, so nothing here can roll back. The owner is deleted afterwards, and the
task goes with it through ``ON DELETE CASCADE``.
"""

import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete

from syncaai.api.dependencies import get_current_user_id
from syncaai.db import get_session_factory
from syncaai.models import Task, User

pytestmark = pytest.mark.integration

TASKS = "/api/v1/tasks"
AN_HOUR = timedelta(minutes=60)


class _Begun(NamedTuple):
    owner: uuid.UUID
    task: uuid.UUID
    start_at: datetime
    end_at: datetime


@pytest.fixture
def begun() -> Iterator[_Begun]:
    """A task that started half an hour ago, inserted directly.

    The API cannot create one: that is the half of ADR-0012's rule 1 that ADR-0027 kept. The
    insert stands in for the time that passed since the task was scheduled.
    """
    with get_session_factory()() as session:
        owner = User(
            email=f"correction-{uuid.uuid4()}@example.com", password_hash="not-a-real-hash"
        )
        session.add(owner)
        session.flush()
        task = Task(
            user_id=owner.id,
            title="already under way",
            start_at=datetime.now(timezone.utc) - timedelta(minutes=30),
            duration_minutes=60,
        )
        session.add(task)
        session.commit()
        seeded = _Begun(owner.id, task.id, task.start_at, task.end_at)
    try:
        yield seeded
    finally:
        with get_session_factory()() as session:
            session.execute(delete(User).where(User.id == seeded.owner))
            session.commit()


def _stored(task: uuid.UUID) -> tuple[datetime, datetime]:
    """The row as the table holds it, read in a session of its own: only what was committed."""
    with get_session_factory()() as session:
        row = session.get_one(Task, task)
        return row.start_at, row.end_at


def _correct(
    app: FastAPI, client: TestClient, begun: _Begun, *, hours_back: int
) -> tuple[datetime, int, str]:
    """Ask for the start to be ``hours_back`` before now, as the task's owner."""
    app.dependency_overrides[get_current_user_id] = lambda: begun.owner
    asked = datetime.now(timezone.utc) - timedelta(hours=hours_back)
    response = client.patch(f"{TASKS}/{begun.task}", json={"start_at": asked.isoformat()})
    return asked, response.status_code, response.text


def test_a_start_corrected_23_hours_back_is_committed_and_end_at_follows_it(
    app: FastAPI, client: TestClient, begun: _Begun
) -> None:
    corrected, status, body = _correct(app, client, begun, hours_back=23)

    assert status == 200, body
    # The end is the trigger's work: the application never writes end_at (ADR-0013).
    assert _stored(begun.task) == (corrected, corrected + AN_HOUR)


def test_a_start_25_hours_back_is_refused_and_the_row_is_left_as_it_was(
    app: FastAPI, client: TestClient, begun: _Begun
) -> None:
    _, status, body = _correct(app, client, begun, hours_back=25)

    assert status == 422, body
    assert "A start can be corrected at most 24 hours back." in body
    assert _stored(begun.task) == (begun.start_at, begun.end_at)
