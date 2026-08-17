"""Integration tests for the invariants PostgreSQL enforces on tasks.

These need a migrated database, so they are marked ``integration`` and run in CI. They
cover the two guarantees that do not exist anywhere in Python: the trigger that derives
``end_at``, and the exclusion constraint that forbids a user's tasks from overlapping.

Nothing is committed — each test rolls back — so they leave no residue.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from syncaai.db import get_session_factory
from syncaai.models import ChecklistItem, Task, User

A_FIXED_FUTURE = datetime(2030, 1, 1, 10, 0, tzinfo=UTC)


def _a_user() -> User:
    return User(email=f"probe-{uuid.uuid4()}@example.test", password_hash="not-a-real-hash")


@pytest.mark.integration
def test_the_database_derives_end_at_from_start_and_duration() -> None:
    with get_session_factory()() as session:
        user = _a_user()
        session.add(user)
        session.flush()

        task = Task(user_id=user.id, title="probe", start_at=A_FIXED_FUTURE, duration_minutes=90)
        session.add(task)
        session.flush()
        session.refresh(task)

        assert task.end_at == A_FIXED_FUTURE + timedelta(minutes=90)

        session.rollback()


@pytest.mark.integration
def test_end_at_follows_a_change_to_duration() -> None:
    with get_session_factory()() as session:
        user = _a_user()
        session.add(user)
        session.flush()

        task = Task(user_id=user.id, title="probe", start_at=A_FIXED_FUTURE, duration_minutes=30)
        session.add(task)
        session.flush()

        task.duration_minutes = 120
        session.flush()
        session.refresh(task)

        assert task.end_at == A_FIXED_FUTURE + timedelta(minutes=120)

        session.rollback()


@pytest.mark.integration
def test_a_user_cannot_have_two_overlapping_tasks() -> None:
    with get_session_factory()() as session:
        user = _a_user()
        session.add(user)
        session.flush()

        session.add(
            Task(user_id=user.id, title="first", start_at=A_FIXED_FUTURE, duration_minutes=60)
        )
        session.flush()

        session.add(
            Task(
                user_id=user.id,
                title="overlapping",
                start_at=A_FIXED_FUTURE + timedelta(minutes=30),
                duration_minutes=60,
            )
        )

        with pytest.raises(IntegrityError):
            session.flush()

        session.rollback()


@pytest.mark.integration
def test_two_users_may_occupy_the_same_slot() -> None:
    """The constraint is per user, not global."""
    with get_session_factory()() as session:
        first, second = _a_user(), _a_user()
        session.add_all([first, second])
        session.flush()

        session.add_all(
            [
                Task(user_id=first.id, title="a", start_at=A_FIXED_FUTURE, duration_minutes=60),
                Task(user_id=second.id, title="b", start_at=A_FIXED_FUTURE, duration_minutes=60),
            ]
        )
        session.flush()

        session.rollback()


@pytest.mark.integration
def test_deleting_a_user_removes_their_tasks_and_checklist_items() -> None:
    """The cascade is the schema's, not the ORM's.

    A Core ``DELETE`` bypasses SQLAlchemy's relationship cascade entirely, so if the
    ``ON DELETE CASCADE`` clauses were missing this would fail on a foreign key violation
    rather than quietly passing. The schema test asserts the clause is declared; this
    asserts the database honours it.
    """
    with get_session_factory()() as session:
        user = _a_user()
        session.add(user)
        session.flush()

        task = Task(user_id=user.id, title="probe", start_at=A_FIXED_FUTURE, duration_minutes=60)
        task.items = [ChecklistItem(label="a step", position=0)]
        session.add(task)
        session.flush()
        task_id = task.id

        session.execute(delete(User).where(User.id == user.id))
        session.expire_all()

        remaining_tasks = session.scalar(
            select(func.count()).select_from(Task).where(Task.id == task_id)
        )
        remaining_items = session.scalar(
            select(func.count()).select_from(ChecklistItem).where(ChecklistItem.task_id == task_id)
        )

        assert remaining_tasks == 0
        assert remaining_items == 0

        session.rollback()
